import { MAT4X4_BYTE_LENGTH } from "./constants";
import { GUI } from "dat.gui";
import {
  createSphere,
  getModelViewProjectionMatrix,
  PointerEventsCallbackData,
  roundUp,
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

const { vertices, indices, texCoords } = createSphere({
  radius: 1,
  latBands: 40,
  longBands: 40,
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

// Uniform Buffer
let uniformBufferSize = MAT4X4_BYTE_LENGTH; // for each planet, we have only a MVP matrix (mat4)
uniformBufferSize = roundUp(
  uniformBufferSize,
  device.limits.minUniformBufferOffsetAlignment,
); // uniform buffer needs to be aligned correctly (it works without it if you don't use dynamic offsets)

// INFO: we are using an async constructor
const textures = await new PlanetTextures(device);

const sampler = device.createSampler({
  label: "sampler element",
  magFilter: "linear",
  minFilter: "linear",
});

// Create Shader Module
const shaderModule = device.createShaderModule({ code: planetWGSL });
console.assert(shaderModule !== null, "Failed to compile shader code");

const bindGroupLayout = device.createBindGroupLayout({
  label: "custom bind group layout",
  entries: [
    {
      binding: 0, // Uniform buffer
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        type: "uniform",
        hasDynamicOffset: true, // Enable dynamic offsets
      },
    },
    {
      binding: 1, // Sampler
      visibility: GPUShaderStage.FRAGMENT,
      sampler: {},
    },
    {
      binding: 2, // Texture
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

  // Create Command Encoder
  const commandEncoder = device.createCommandEncoder({
    label: "command encoder",
  });

  const renderPass = commandEncoder.beginRenderPass(passDescriptor);
  renderPass.setPipeline(pipeline);
  renderPass.setVertexBuffer(0, vertexBuffer);
  renderPass.setVertexBuffer(1, texCoordBuffer);
  renderPass.setIndexBuffer(indexBuffer, "uint32");

  const uniformBuffer = device.createBuffer({
    label: "uniform coordinates buffer",
    size: uniformBufferSize * settings.planets,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Fill in all uniform MVP matrices beforehand so you don't have to
  // `device.queue.writeBuffer` for each one of the planets.
  const allMatrices = new Float32Array(
    (uniformBufferSize * settings.planets) / Float32Array.BYTES_PER_ELEMENT,
  );
  let previousTranslation: vec3 = [0, 0, 0];
  for (let i = 0; i < settings.planets; i++) {
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
    allMatrices.set(
      mvpMatrix,
      i * (uniformBufferSize / Float32Array.BYTES_PER_ELEMENT),
    );
  }

  // Update MVP Matrices
  device.queue.writeBuffer(uniformBuffer, 0, allMatrices);

  for (let i = 0; i < settings.planets; i++) {
    const dynamicOffset = i * uniformBufferSize;

    const texture = textures.getTextureBasedOnIndex(i);
    console.assert(texture !== null, `Failed to load texture ${i}`);

    // Bind Group
    const bindGroup = device.createBindGroup({
      label: "bind group element",
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: uniformBuffer,
            size: uniformBufferSize,
          },
        },
        { binding: 1, resource: sampler },
        { binding: 2, resource: texture.createView() },
      ],
    });

    renderPass.setBindGroup(0, bindGroup, [dynamicOffset]);
    renderPass.drawIndexed(indices.length);
  }

  // Finalise render pass
  renderPass.end();

  // Submit Commands
  device.queue.submit([commandEncoder.finish()]);

  // Request Next Frame
  requestAnimationFrame(frame);
}

export const initPlanet = () => {
  requestAnimationFrame(frame);
};
