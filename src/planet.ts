import EarthTexture from "/textures/earth.png";
import { MAT4X4_BYTE_LENGTH } from "./constants";
import {
  createSphere,
  getModelViewProjectionMatrix,
  PointerEventsCallbackData,
  setupPointerEvents,
  webGPUTextureFromImageUrl,
} from "./utils";
import { initWebGPUAndCanvas } from "./webgpu";
import { vec3 } from "gl-matrix";

// Shader Code
const shaderCode = `
struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) texCoord: vec2<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0)
var<uniform> mvpMatrix: mat4x4<f32>;

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = mvpMatrix * vec4<f32>(input.position, 1.0);
  output.uv = input.texCoord;
  return output;
}

@group(0) @binding(1)
var textureSampler: sampler;
@group(0) @binding(2)
var sphereTexture: texture_2d<f32>;

@fragment
fn main_fragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(sphereTexture, textureSampler, uv);
}
`;

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
  latBands: 30,
  lonBands: 30,
});

// Create Vertex Buffer
const vertexBuffer = device.createBuffer({
  label: "vertices buffer",
  size: vertices.length * Float32Array.BYTES_PER_ELEMENT,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  mappedAtCreation: true,
});
new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
vertexBuffer.unmap();

// Create Index Buffer
const indexBuffer = device.createBuffer({
  label: "index buffer",
  size: indices.length * Float32Array.BYTES_PER_ELEMENT,
  usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  mappedAtCreation: true,
});
new Uint32Array(indexBuffer.getMappedRange()).set(indices);
indexBuffer.unmap();

// Create Texture Coordinates Buffer
const texCoordBuffer = device.createBuffer({
  label: "texture coordinates buffer",
  size: texCoords.length * Float32Array.BYTES_PER_ELEMENT,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  mappedAtCreation: true,
});
new Float32Array(texCoordBuffer.getMappedRange()).set(texCoords);
texCoordBuffer.unmap();

// Uniform Buffer
const uniformBuffer = device.createBuffer({
  label: "uniform coordinates buffer",
  size: MAT4X4_BYTE_LENGTH,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const texture = await webGPUTextureFromImageUrl(device, EarthTexture);

const sampler = device.createSampler({
  label: "sampler element",
  magFilter: "linear",
  minFilter: "linear",
});

// Create Shader Module
const shaderModule = device.createShaderModule({ code: shaderCode });
console.assert(shaderModule !== null, "Failed to compile shader code");

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

// Bind Group
const bindGroup = device.createBindGroup({
  label: "bind group element",
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: sampler },
    { binding: 2, resource: texture.createView() },
  ],
});

const passDescriptor: GPURenderPassDescriptor = {
  label: "pass descriptor element",
  colorAttachments: [
    {
      view: undefined,
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

function frame() {
  const cameraEye: vec3 = [0, 0, scale];
  const cameraLookupCenter: vec3 = [-offsetX, offsetY, 0];
  const cameraUp: vec3 = [0, 1, 0];

  const mvpMatrix = getModelViewProjectionMatrix({
    modelRotationX: rotationAngleX,
    modelRotationY: rotationAngleY,
    cameraEye,
    cameraLookupCenter,
    cameraUp,
    perspectiveAspectRatio,
  });

  // Update MVP Matrix
  device.queue.writeBuffer(uniformBuffer, 0, mvpMatrix);

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
  renderPass.setBindGroup(0, bindGroup);
  renderPass.drawIndexed(indices.length);
  renderPass.end();

  // Submit Commands
  device.queue.submit([commandEncoder.finish()]);

  // Request Next Frame
  requestAnimationFrame(frame);
}

export const initPlanet = () => {
  requestAnimationFrame(frame);
};
