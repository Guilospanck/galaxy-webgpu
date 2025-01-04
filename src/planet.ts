import { MAT4X4_BYTE_LENGTH } from "./constants";
import { GUI } from "dat.gui";
import {
  createSphereMesh,
  getModelMatrix,
  getViewProjectionMatrix,
  PointerEventsCallbackData,
  setupPointerEvents,
} from "./utils";
import { initWebGPUAndCanvas } from "./webgpu";
import { vec3 } from "gl-matrix";
import { PlanetTextures } from "./textures";
import planetWGSL from "./shaders/planet.wgsl?raw";

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
  gui.add(settings, "planets", 1, 1200).step(1);
};
setupUI();

/// Pointer events
let rotationAngleX = 0;
let rotationAngleY = 0;
let scale = 5;
let offsetX = 0;
let offsetY = 0;
const callbackUpdatePointerEvents = (data: PointerEventsCallbackData): void => {
  rotationAngleX = data.rotationAngleX;
  rotationAngleY = data.rotationAngleY;
  scale = data.scale;
  offsetX = data.offsetX;
  offsetY = data.offsetY;
};
setupPointerEvents({
  canvas,
  rotationAngleX,
  rotationAngleY,
  scale,
  offsetX,
  offsetY,
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

// Pipeline
const pipeline = device.createRenderPipeline({
  label: "render pipeline",
  layout: "auto",
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

/// INFO: One point about this: it is saving the planets' state in memory (planetsBuffer array)
/// Therefore in the case that we select to render less planets than we currently have,
/// it will still keep those states in memory.
/// This is a trade-off between saving this states in memory or re-creating them.
///
const planetsBuffers = [];
const createPlanets = () => {
  for (let i = 0; i < settings.planets; i++) {
    if (i < planetsBuffers.length - 1) {
      continue;
    }

    // Create meshes and buffers, randomizing the radius of the planet
    const { vertexBuffer, indexBuffer, indices } = createPlanetAndItsBuffers({
      radius: Math.random() * 3,
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
createPlanets();

const renderPlanets = ({
  viewProjectionMatrixUniformBuffer,
}: {
  viewProjectionMatrixUniformBuffer: GPUBuffer;
}) => {
  // Create Command Encoder
  const commandEncoder = device.createCommandEncoder({
    label: "command encoder",
  });

  const renderPass = commandEncoder.beginRenderPass(passDescriptor);

  renderPass.setPipeline(pipeline);

  let previousTranslation: vec3 = [0, 0, 0];
  for (let i = 0; i < settings.planets; i++) {
    const { vertexBuffer, indexBuffer, indices, texture } = planetsBuffers[i];

    // TODO: change this code
    const modelTranslation: vec3 = vec3.add(emptyVector, previousTranslation, [
      i < 2 ? 2 : i % 2 === 0 ? i : -i,
      i < 2 ? 2 : i % 2 === 0 ? i : -i,
      i < 2 ? 2 : i % 2 === 0 ? i : -i,
    ]);
    previousTranslation = modelTranslation;

    const modelMatrix = getModelMatrix({
      modelTranslation,
      modelRotationZ: new Date().getTime() * 0.0001 + i,
    });

    // Create model matrix uniform buffer
    const modelMatrixUniformBuffer = device.createBuffer({
      label: "model matrix uniform coordinates buffer",
      size: MAT4X4_BYTE_LENGTH,
      usage: GPUBufferUsage.UNIFORM,
      mappedAtCreation: true,
    });
    new Float32Array(modelMatrixUniformBuffer.getMappedRange()).set(
      modelMatrix,
    );
    modelMatrixUniformBuffer.unmap();

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
          },
        },
        { binding: 2, resource: sampler },
        { binding: 3, resource: texture.createView() },
      ],
    });

    renderPass.setVertexBuffer(0, vertexBuffer); // position and texCoords
    renderPass.setIndexBuffer(indexBuffer, "uint32");
    renderPass.setBindGroup(0, bindGroup);
    renderPass.drawIndexed(indices.length);
  }

  // Finalise render pass
  renderPass.end();

  // Submit Commands
  device.queue.submit([commandEncoder.finish()]);
};

function frame() {
  // INFO: this is needed here because of pointer events
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

  // TODO: check if using the device.queue.writeBuffer is faster than
  // creating a buffer each frame.
  //
  // Create view projection matrix uniform buffer
  const viewProjectionMatrixUniformBuffer = device.createBuffer({
    label: "view projection matrix uniform coordinates buffer",
    size: MAT4X4_BYTE_LENGTH,
    usage: GPUBufferUsage.UNIFORM,
    mappedAtCreation: true,
  });
  new Float32Array(viewProjectionMatrixUniformBuffer.getMappedRange()).set(
    viewProjectionMatrix,
  );
  viewProjectionMatrixUniformBuffer.unmap();

  // Update Texture View
  passDescriptor.colorAttachments[0].view = context
    .getCurrentTexture()
    .createView();

  createPlanets();
  renderPlanets({
    viewProjectionMatrixUniformBuffer,
  });

  // Request Next Frame
  requestAnimationFrame(frame);
}

export const initPlanet = () => {
  requestAnimationFrame(frame);
};
