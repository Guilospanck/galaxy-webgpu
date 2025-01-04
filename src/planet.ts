import { MAT4X4_BYTE_LENGTH } from "./constants";
import { GUI } from "dat.gui";
import {
  createSphereMesh,
  getModelViewProjectionMatrix,
  PointerEventsCallbackData,
  setupPointerEvents,
} from "./utils";
import { initWebGPUAndCanvas } from "./webgpu";
import { vec3 } from "gl-matrix";
import { PlanetTextures } from "./textures";
import planetWGSL from "./shaders/planet.wgsl?raw";

const settings = {
  planets: 5,
};

const setupUI = () => {
  const gui = new GUI();
  gui.add(settings, "planets", 1, 1200).step(1);
};
setupUI();

let rotationAngleX = 0;
let rotationAngleY = 0;
let scale = 5;
let offsetX = 0;
let offsetY = 0;

const { canvas, context, device, format } = await initWebGPUAndCanvas();

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

// Create Shader Module
const shaderModule = device.createShaderModule({ code: planetWGSL });
console.assert(shaderModule !== null, "Failed to compile shader code");

// INFO: we are using an async constructor
const textures = await new PlanetTextures(device);

type PlanetBuffers = {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  texCoordBuffer: GPUBuffer;
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
  const { vertices, indices, texCoords } = createSphereMesh({
    radius,
    latBands,
    longBands,
  });

  // Create Vertex Buffer
  const vertexBuffer = device.createBuffer({
    label: "vertices buffer",
    size: vertices.length * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
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

  // Create Texture Coordinates Buffer
  const texCoordBuffer = device.createBuffer({
    label: "texture coordinates buffer",
    size: texCoords.length * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(texCoordBuffer.getMappedRange()).set(texCoords);
  texCoordBuffer.unmap();

  return {
    vertexBuffer,
    indexBuffer,
    texCoordBuffer,
    indices,
  };
};

const planetsBuffers = [];
/// One point about this: it is saving the planets' state in memory (planetsBuffer array)
/// Therefore in the case that we select to render less planets than we currently have,
/// it will still keep those states in memory.
/// This is a trade-off between saving this states in memory or re-creating them.
///
const createPlanets = () => {
  for (let i = 0; i < settings.planets; i++) {
    if (i < planetsBuffers.length - 1) {
      continue;
    }

    // Create meshes and buffers
    const { vertexBuffer, indexBuffer, texCoordBuffer, indices } =
      createPlanetAndItsBuffers({
        radius: Math.random() * 3,
      });

    // Create texture buffer
    const texture = textures.getTextureBasedOnIndex(i);
    console.assert(texture !== null, `Failed to load texture ${i}`);

    planetsBuffers.push({
      vertexBuffer,
      indexBuffer,
      texCoordBuffer,
      indices,
      texture,
    });
  }
};
createPlanets();

const createRenderedPlanets = ({
  cameraUp,
  cameraEye,
  cameraLookupCenter,
  translationVec,
  emptyVector,
  perspectiveAspectRatio,
  movement,
}: {
  cameraUp: vec3;
  cameraEye: vec3;
  cameraLookupCenter: vec3;
  translationVec: vec3;
  emptyVector: vec3;
  perspectiveAspectRatio: number;
  movement: number;
}) => {
  // Create Command Encoder
  const commandEncoder = device.createCommandEncoder({
    label: "command encoder",
  });

  const renderPass = commandEncoder.beginRenderPass(passDescriptor);

  renderPass.setPipeline(pipeline);

  let previousTranslation: vec3 = [0, 0, 0];
  for (let i = 0; i < settings.planets; i++) {
    const { vertexBuffer, indexBuffer, texCoordBuffer, indices, texture } =
      planetsBuffers[i];

    const modelTranslation: vec3 = vec3.add(
      emptyVector,
      previousTranslation,
      translationVec,
    );
    previousTranslation = modelTranslation;

    const mvpMatrix = getModelViewProjectionMatrix({
      cameraRotationX: rotationAngleX,
      cameraRotationY: rotationAngleY,
      cameraRotationZ: movement * i + 0.0001,
      modelTranslation,
      cameraEye,
      cameraLookupCenter,
      cameraUp,
      perspectiveAspectRatio,
    });

    // Create uniform buffer
    const uniformBuffer = device.createBuffer({
      label: "uniform coordinates buffer",
      size: MAT4X4_BYTE_LENGTH,
      usage: GPUBufferUsage.UNIFORM,
      mappedAtCreation: true,
    });
    new Float32Array(uniformBuffer.getMappedRange()).set(mvpMatrix);
    uniformBuffer.unmap();

    // Bind Group
    const bindGroup = device.createBindGroup({
      label: "bind group element",
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: uniformBuffer,
          },
        },
        { binding: 1, resource: sampler },
        { binding: 2, resource: texture.createView() },
      ],
    });

    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.setVertexBuffer(1, texCoordBuffer);
    renderPass.setIndexBuffer(indexBuffer, "uint32");
    renderPass.setBindGroup(0, bindGroup);
    renderPass.drawIndexed(indices.length);
  }

  // Finalise render pass
  renderPass.end();

  // Submit Commands
  device.queue.submit([commandEncoder.finish()]);
};

const sampler = device.createSampler({
  label: "sampler element",
  magFilter: "linear",
  minFilter: "linear",
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
        arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT, // position
        attributes: [{ shaderLocation: 0, format: "float32x3", offset: 0 }],
      },
      {
        arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT, // texCoord
        attributes: [{ shaderLocation: 1, format: "float32x2", offset: 0 }],
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

// Depth Buffer
const depthTexture = device.createTexture({
  label: "depth texture",
  size: [canvas.width, canvas.height],
  format: "depth24plus",
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
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

const perspectiveAspectRatio = canvas.width / canvas.height;
const emptyVector: vec3 = [0, 0, 0];
const translationVec: vec3 = [4, 0, 0];
const cameraUp: vec3 = [0, 1, 0];

function frame() {
  let movement = new Date().getTime() * 0.0001;

  // Camera-related (for the view matrix)
  const cameraEye: vec3 = [0, 0, scale];
  const cameraLookupCenter: vec3 = [-offsetX, offsetY, 0];

  // Update Texture View
  passDescriptor.colorAttachments[0].view = context
    .getCurrentTexture()
    .createView();

  createPlanets();
  createRenderedPlanets({
    cameraUp,
    cameraEye,
    cameraLookupCenter,
    translationVec,
    emptyVector,
    perspectiveAspectRatio,
    movement,
  });

  // Request Next Frame
  requestAnimationFrame(frame);
}

export const initPlanet = () => {
  requestAnimationFrame(frame);
};
