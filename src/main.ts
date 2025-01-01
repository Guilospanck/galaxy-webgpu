import "./style.css";
import { mat4 } from "gl-matrix";

// Shader Code
const shaderCode = `
struct VertexInput {
  @location(0) position: vec4<f32>,
  @location(1) color: vec4<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
}

@group(0) @binding(0)
var<uniform> matrices: mat4x4f;

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let pos = matrices * input.position;
  output.position = pos;
  output.color = input.color;
  output.uv = vec2<f32>(input.position.x * 0.5 + 0.5, input.position.y * 0.5 + 0.5); // UV mapping
  return output;
}

@group(0) @binding(1)
var starTexture: texture_2d<f32>;
@group(0) @binding(2)
var starSampler: sampler;

@fragment
fn main_fragment(@location(0) color: vec4<f32>, @location(1) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var texColor = textureSample(starTexture, starSampler, uv).rgb;
  let texColor4f = vec4<f32>(texColor, 1.0);
  return color * texColor4f;
}
`;

const MAT4X4_BYTE_LENGTH = 4 * 4 * 4;

if (!navigator?.gpu) {
  throw Error("WebGPU not supported.");
}

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
  throw Error("Couldn't request WebGPU adapter.");
}

const device = await adapter.requestDevice();

// Create Shader Modules
const shaderModule = device.createShaderModule({ code: shaderCode });

const canvas = <HTMLCanvasElement>document.getElementById("galaxy");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const context = canvas.getContext("webgpu") as GPUCanvasContext;

const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({
  device,
  format,
});

// Vertex Data (3D Galaxy)
const vertexData = [];
const starCount = 1000;

for (let i = 0; i < starCount; i++) {
  const angle = Math.random() * 2 * Math.PI;
  const radius = Math.random();
  const height = (Math.random() - 0.5) * 0.2; // Spread stars in the Z-axis
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;
  const z = height;
  const w = 1;
  const r = Math.random();
  const g = Math.random();
  const b = Math.random();
  const a = 1;
  vertexData.push(x, y, z, w, r, g, b, a);
}

const vertices = new Float32Array(vertexData);

const vertexBuffer = device.createBuffer({
  size: vertices.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(vertexBuffer, 0, vertices, 0, vertices.length);

// Uniform Buffer (Projection and View Matrix)
const uniformBuffer = device.createBuffer({
  size: MAT4X4_BYTE_LENGTH,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// Load Texture
const TEXTURE_WIDTH = 256;
const TEXTURE_HEIGHT = 256;
const texture = device.createTexture({
  size: [TEXTURE_WIDTH, TEXTURE_HEIGHT],
  format: "rgba8unorm",
  usage:
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_DST |
    GPUTextureUsage.RENDER_ATTACHMENT,
});

// Fill texture with random star patterns
const textureData = new Uint8Array(TEXTURE_WIDTH * TEXTURE_HEIGHT * 4);
for (let i = 0; i < textureData.length; i += 4) {
  const brightness = Math.random() > 0.95 ? 255 : 0; // Sparse stars
  textureData[i] = brightness;
  textureData[i + 1] = brightness;
  textureData[i + 2] = brightness;
  textureData[i + 3] = 255;
}
device.queue.writeTexture(
  { texture },
  textureData,
  { bytesPerRow: TEXTURE_WIDTH * 4 },
  { width: TEXTURE_WIDTH, height: TEXTURE_HEIGHT, depthOrArrayLayers: 1 },
);

const sampler = device.createSampler({
  magFilter: "linear",
  minFilter: "linear",
});

// Pipeline
const DEPTH_FORMAT = "depth24plus";
const pipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {
    module: shaderModule,
    entryPoint: "main",
    buffers: [
      {
        arrayStride: vertices.BYTES_PER_ELEMENT * 8, // 4 (position) + 4 (color) * 4 bytes
        attributes: [
          { shaderLocation: 0, format: "float32x4", offset: 0 }, // position
          {
            shaderLocation: 1,
            format: "float32x4",
            offset: vertices.BYTES_PER_ELEMENT * 4,
          }, // color
        ],
      },
    ],
  },
  fragment: {
    module: shaderModule,
    entryPoint: "main_fragment",
    targets: [{ format }],
  },
  primitive: { topology: "point-list" },
  depthStencil: {
    format: DEPTH_FORMAT,
    depthWriteEnabled: true,
    depthCompare: "less",
  },
});

// Depth Buffer
const depthTexture = device.createTexture({
  size: [canvas.width, canvas.height],
  format: DEPTH_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
});

// Bind Group
const bindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: texture.createView() },
    { binding: 2, resource: sampler },
  ],
});

const textureView = context.getCurrentTexture().createView();

const renderPassDescriptor: GPURenderPassDescriptor = {
  colorAttachments: [
    {
      view: textureView,
      loadOp: "clear",
      storeOp: "store",
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
    },
  ],
  depthStencilAttachment: {
    view: depthTexture.createView(),
    depthLoadOp: "clear",
    depthStoreOp: "store",
    depthClearValue: 1.0,
  },
};

// Animation Loop
let time = 0;

const NEAR_FRUSTUM = 0.1;
const FAR_FRUSTUM = 100;

function frame() {
  time += 1;

  // Update Uniform Buffer (Projection and Rotation)
  const projectionMatrix = mat4.perspective(
    mat4.create(),
    Math.PI / 4,
    canvas.width / canvas.height,
    NEAR_FRUSTUM,
    FAR_FRUSTUM,
  );
  const viewMatrix = mat4.lookAt(
    mat4.create(),
    [0, time, 0], // eye: the position of the camera
    [0, 0, 0], // center: the point at which the camera is looking at
    [0, 0, 1], // up: The up vector should be orthogonal to the viewing direction
  );
  const modelMatrix = mat4.rotateZ(mat4.create(), mat4.create(), time);
  const matrix = mat4.multiply(
    mat4.create(),
    projectionMatrix,
    mat4.multiply(mat4.create(), viewMatrix, modelMatrix),
  );

  device.queue.writeBuffer(
    uniformBuffer,
    0,
    (matrix as Float32Array).buffer,
    0,
    MAT4X4_BYTE_LENGTH,
  );

  // Render
  const commandEncoder = device.createCommandEncoder();
  const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
  passEncoder.setPipeline(pipeline);
  passEncoder.setVertexBuffer(0, vertexBuffer);
  passEncoder.setBindGroup(0, bindGroup);
  passEncoder.draw(starCount);
  passEncoder.end();

  device.queue.submit([commandEncoder.finish()]);
  requestAnimationFrame(frame);
}

frame();
