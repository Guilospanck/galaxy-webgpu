import { MAT4X4_BYTE_LENGTH } from "./constants";
import { GUI } from "dat.gui";
import {
  calculateXYZEllipseCoordinates,
  createSphereMesh,
  getModelMatrix,
  getViewProjectionMatrix,
  hasCameraChangedPositions,
  PointerEventsCallbackData,
  PointerEventsTransformations,
  roundUp,
  setupPointerEvents,
} from "./utils";
import { initWebGPUAndCanvas } from "./webgpu";
import { mat4, vec3 } from "gl-matrix";
import { PlanetTextures } from "./textures";
import planetWGSL from "./shaders/planet.wgsl?raw";
import Stats from "stats.js";

const stats = new Stats();
stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom);

/// Load canvas and GPU devices
/// If the user/browser doesn't have working WebGPU yet, this will throw early.
const { canvas, context, device, format } = await initWebGPUAndCanvas();

const perspectiveAspectRatio = canvas.width / canvas.height;
const emptyVector: vec3 = [0, 0, 0];
const cameraUp: vec3 = [0, 1, 0];

/// UI related
const settings = {
  planets: 5,
};
const setupUI = () => {
  const gui = new GUI();
  gui.add(settings, "planets", 1, 12000).step(1);
};
setupUI();

/// Pointer events
const pointerEvents: PointerEventsTransformations = {
  rotationAngleX: 0,
  rotationAngleY: 0,
  scale: 5,
  offsetX: 0,
  offsetY: 0,
};
const callbackUpdatePointerEvents = (data: PointerEventsCallbackData): void => {
  pointerEvents.rotationAngleX = data.rotationAngleX;
  pointerEvents.rotationAngleY = data.rotationAngleY;
  pointerEvents.scale = data.scale;
  pointerEvents.offsetX = data.offsetX;
  pointerEvents.offsetY = data.offsetY;
};
setupPointerEvents({
  canvas,
  pointerEvents,
  callback: callbackUpdatePointerEvents,
});

// Create Shader Module from WGSL file
const shaderModule = device.createShaderModule({ code: planetWGSL });
console.assert(shaderModule !== null, "Failed to compile shader code");

// INFO: we are using an async constructor
const textures = await new PlanetTextures(device);

const sampler = device.createSampler({
  label: "sampler element",
  magFilter: "linear",
  minFilter: "linear",
});

// Depth Buffer
const depthTexture = device.createTexture({
  label: "depth texture",
  size: [canvas.width, canvas.height],
  format: "depth24plus",
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
});

// Custom bind group that sets model matrix uniform buffer with a dynamic offset
const bindGroupLayout = device.createBindGroupLayout({
  label: "custom bind group layout",
  entries: [
    {
      binding: 0, // View-Projection matrix buffer
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        type: "uniform",
      },
    },
    {
      binding: 1, // Model matrix buffer
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        type: "uniform",
        hasDynamicOffset: true, // Enable dynamic offsets
      },
    },
    {
      binding: 2, // Sampler
      visibility: GPUShaderStage.FRAGMENT,
      sampler: {},
    },
    {
      binding: 3, // Texture
      visibility: GPUShaderStage.FRAGMENT,
      texture: {},
    },
  ],
});

// Pipeline
const pipeline = device.createRenderPipeline({
  label: "render pipeline",
  layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
  vertex: {
    module: shaderModule,
    entryPoint: "main",
    buffers: [
      {
        arrayStride: 5 * Float32Array.BYTES_PER_ELEMENT, // 3 position + 2 texCoord
        attributes: [
          // position
          {
            shaderLocation: 0,
            format: "float32x3",
            offset: 0,
          },
          // texCoord
          {
            shaderLocation: 1,
            format: "float32x2",
            offset: 3 * Float32Array.BYTES_PER_ELEMENT,
          },
        ],
      },
    ],
  },
  fragment: {
    module: shaderModule,
    entryPoint: "main_fragment",
    targets: [{ format }],
  },
  primitive: { topology: "triangle-list" },
  depthStencil: {
    format: "depth24plus",
    depthWriteEnabled: true,
    depthCompare: "less",
  },
});

const passDescriptor: GPURenderPassDescriptor = {
  label: "pass descriptor element",
  colorAttachments: [
    {
      view: undefined, // assigned later
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    },
  ],
  depthStencilAttachment: {
    view: depthTexture.createView(),
    depthLoadOp: "clear",
    depthStoreOp: "store",
    depthClearValue: 1.0,
  },
};

let viewProjectionMatrixUniformBuffer: GPUBuffer;
const calculateAndSetViewProjectionMatrix = ({
  rotationAngleX,
  rotationAngleY,
  scale,
  offsetX,
  offsetY,
}: PointerEventsTransformations) => {
  // Create view projection matrix uniform buffer
  viewProjectionMatrixUniformBuffer = device.createBuffer({
    label: "view projection matrix uniform coordinates buffer",
    size: MAT4X4_BYTE_LENGTH,
    usage: GPUBufferUsage.UNIFORM,
    mappedAtCreation: true,
  });
  const cameraEye: vec3 = [0, 0, scale];
  const cameraLookupCenter: vec3 = [-offsetX, offsetY, 0];
  const viewProjectionMatrix = getViewProjectionMatrix({
    cameraRotationX: -rotationAngleY,
    cameraRotationZ: rotationAngleX,
    cameraEye,
    cameraLookupCenter,
    cameraUp,
    perspectiveAspectRatio,
  });

  new Float32Array(viewProjectionMatrixUniformBuffer.getMappedRange()).set(
    viewProjectionMatrix,
  );
  viewProjectionMatrixUniformBuffer.unmap();
};
calculateAndSetViewProjectionMatrix(pointerEvents);

// Model Matrix Uniform Buffer
let modelMatrixUniformBufferSize = MAT4X4_BYTE_LENGTH; // for each planet, we have only a MVP matrix (mat4)
modelMatrixUniformBufferSize = roundUp(
  modelMatrixUniformBufferSize,
  device.limits.minUniformBufferOffsetAlignment,
); // uniform buffer needs to be aligned correctly (it works without it if you don't use dynamic offsets)

type PlanetBuffers = {
  vertexBuffer: GPUBuffer; // position and texCoords
  indexBuffer: GPUBuffer;
  indices: number[];
};

const createPlanetAndItsBuffers = ({
  radius = 1,
  latBands = 40,
  longBands = 40,
}: {
  radius?: number;
  latBands?: number;
  longBands?: number;
}): PlanetBuffers => {
  const { positionAndTexCoords, indices } = createSphereMesh({
    radius,
    latBands,
    longBands,
  });

  // Create Position and TexCoords Buffer (VERTEX BUFFER)
  const vertexBuffer = device.createBuffer({
    label: "vertices buffer",
    size: positionAndTexCoords.length * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(vertexBuffer.getMappedRange()).set(positionAndTexCoords);
  vertexBuffer.unmap();

  // Create Index Buffer
  const indexBuffer = device.createBuffer({
    label: "index buffer",
    size: indices.length * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.INDEX,
    mappedAtCreation: true,
  });
  new Uint32Array(indexBuffer.getMappedRange()).set(indices);
  indexBuffer.unmap();

  return {
    vertexBuffer,
    indexBuffer,
    indices,
  };
};

const setModelMatrixUniformBuffer = (): GPUBuffer => {
  // Fill in all uniform MVP matrices beforehand so you don't have to
  // `device.queue.writeBuffer` (or direct mapping) for each one of the planets.
  const allModelMatrices = new Float32Array(
    (modelMatrixUniformBufferSize * settings.planets) /
      Float32Array.BYTES_PER_ELEMENT,
  );

  const rotation = new Date().getTime() * 0.0001;

  let previousTranslation: vec3 = [0, 0, 0];
  for (let i = 0; i < settings.planets; i++) {
    const { x, y, z } = calculateXYZEllipseCoordinates(i % 360);

    previousTranslation = vec3.add(emptyVector, previousTranslation, [i, i, i]);
    previousTranslation = vec3.add(emptyVector, previousTranslation, [x, y, z]);

    const translation = new Date().getTime() * 0.0001 + i;

    // Matrix responsible for the planet movement of translation
    const translationMatrix = mat4.rotateZ(
      mat4.create(),
      mat4.create(),
      translation,
    );
    let modelMatrix = getModelMatrix({
      modelTranslation: previousTranslation,
      modelRotationZ: rotation,
    });

    modelMatrix = new Float32Array(
      mat4.multiply(mat4.create(), translationMatrix, modelMatrix),
    );

    allModelMatrices.set(
      modelMatrix,
      i * (modelMatrixUniformBufferSize / Float32Array.BYTES_PER_ELEMENT),
    );
  }

  // Add those matrices to the uniform buffer
  const modelMatrixUniformBuffer = device.createBuffer({
    label: "model matrix uniform coordinates buffer",
    size: modelMatrixUniformBufferSize * settings.planets,
    usage: GPUBufferUsage.UNIFORM,
    mappedAtCreation: true,
  });
  new Float32Array(modelMatrixUniformBuffer.getMappedRange()).set(
    allModelMatrices,
  );
  modelMatrixUniformBuffer.unmap();

  return modelMatrixUniformBuffer;
};

/// INFO: One point about this: it is saving the planets' state in memory (planetsBuffer array)
/// Therefore in the case that we select to render less planets than we currently have,
/// it will still keep those states in memory.
/// This is a trade-off between saving this states in memory or re-creating them.
///
const planetsBuffers = [];
const createPlanets = (numberOfPlanets: number) => {
  for (let i = 0; i < numberOfPlanets; i++) {
    if (i < planetsBuffers.length - 1) {
      continue;
    }

    let radius = Math.random() * 2 + 1;

    // Create meshes and buffers, randomizing the radius of the planet
    const { vertexBuffer, indexBuffer, indices } = createPlanetAndItsBuffers({
      radius,
    });

    // Create texture buffer
    const texture = textures.getTextureBasedOnIndex(i % textures.length);
    console.assert(texture !== null, `Failed to load texture ${i}`);

    planetsBuffers.push({
      vertexBuffer,
      indexBuffer,
      indices,
      texture,
    });
  }
};
createPlanets(settings.planets);

const renderPlanets = () => {
  // Create Command Encoder
  const commandEncoder = device.createCommandEncoder({
    label: "command encoder",
  });

  const renderPass = commandEncoder.beginRenderPass(passDescriptor);

  renderPass.setPipeline(pipeline);

  const modelMatrixUniformBuffer = setModelMatrixUniformBuffer();

  for (let i = 0; i < settings.planets; i++) {
    const dynamicOffset = i * modelMatrixUniformBufferSize;

    const { vertexBuffer, indexBuffer, indices, texture } = planetsBuffers[i];

    // Bind Group
    const bindGroup = device.createBindGroup({
      label: "bind group element",
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: viewProjectionMatrixUniformBuffer,
          },
        },
        {
          binding: 1,
          resource: {
            buffer: modelMatrixUniformBuffer,
            size: modelMatrixUniformBufferSize,
          },
        },
        { binding: 2, resource: sampler },
        { binding: 3, resource: texture.createView() },
      ],
    });

    renderPass.setVertexBuffer(0, vertexBuffer); // position and texCoords
    renderPass.setIndexBuffer(indexBuffer, "uint32");
    renderPass.setBindGroup(0, bindGroup, [dynamicOffset]);
    renderPass.drawIndexed(indices.length);
  }

  // Finalise render pass
  renderPass.end();

  // Submit Commands
  device.queue.submit([commandEncoder.finish()]);
};

/// Variables to check for conditional rendering
// INFO: this variable is NOT updated automatically when settings.planets change.
let currentPlanets = settings.planets;
// INFO: this also is NOT when rotation angles change
let currentCameraConfigurations: PointerEventsTransformations = {
  ...pointerEvents,
};

function frame() {
  stats.begin();

  // Update Texture View
  passDescriptor.colorAttachments[0].view = context
    .getCurrentTexture()
    .createView();

  // Only recalculate View-Projection matrix if the camera position has changed.
  if (hasCameraChangedPositions(currentCameraConfigurations, pointerEvents)) {
    calculateAndSetViewProjectionMatrix(pointerEvents);
    currentCameraConfigurations = { ...pointerEvents };
  }

  // Only create new planets if we change the settings.planets UI variable
  if (currentPlanets !== settings.planets) {
    createPlanets(settings.planets);
    currentPlanets = settings.planets;
  }

  renderPlanets();

  stats.end();

  // Request Next Frame
  requestAnimationFrame(frame);
}

export const initPlanet = () => {
  requestAnimationFrame(frame);
};
