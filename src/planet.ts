import { mat4 } from "gl-matrix";
import EarthTexture from "/textures/earth.png";

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

let isDragging = false;
let lastPointerX: number | null = null;
let lastPointerY: number | null = null;

let rotationAngleX = 0;
let rotationAngleY = 0;
let scale = 5;
let offsetX = 0;
let offsetY = 0;

const setupPointerEvents = (canvas: HTMLCanvasElement) => {
  canvas.addEventListener("pointerdown", (event) => {
    isDragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!isDragging || lastPointerX === null || lastPointerY === null) return;

    const deltaX = event.clientX - lastPointerX;
    const deltaY = event.clientY - lastPointerY;

    if (event.shiftKey) {
      // Rotate if Shift key is pressed
      rotationAngleX += deltaX * 0.01; // Adjust sensitivity
      rotationAngleY += deltaY * 0.01; // Adjust sensitivity
    } else {
      // Pan otherwise
      offsetX += deltaX * 0.01;
      offsetY += deltaY * 0.01;
    }

    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
  });

  canvas.addEventListener("pointerup", () => {
    isDragging = false;
    lastPointerX = null;
    lastPointerY = null;
  });

  canvas.addEventListener("pointerleave", () => {
    isDragging = false;
    lastPointerX = null;
    lastPointerY = null;
  });

  // Wheel event for zooming
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();

    const zoomFactor = 1.1; // Adjust sensitivity
    if (event.deltaY < 0) {
      scale *= zoomFactor; // Zoom in
    } else {
      scale /= zoomFactor; // Zoom out
    }
  });
};

if (!navigator?.gpu) {
  throw Error("WebGPU not supported.");
}

const adapter = await navigator.gpu.requestAdapter();
if (!adapter) {
  throw Error("Couldn't request WebGPU adapter.");
}

const device = await adapter.requestDevice();
device.lost.then((info) => {
  console.error("GPU device lost:", info.message);
});

const canvas = <HTMLCanvasElement>document.getElementById("galaxy");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const context = canvas.getContext("webgpu") as GPUCanvasContext;

const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({
  device,
  format,
});

// Sphere generation
function createSphere(radius: number, latBands: number, lonBands: number) {
  const vertices = [];
  const indices = [];
  const texCoords = [];
  const normals = [];

  for (let lat = 0; lat <= latBands; ++lat) {
    const theta = (lat * Math.PI) / latBands; // Latitude angle
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= lonBands; ++lon) {
      const phi = (lon * 2 * Math.PI) / lonBands; // Longitude angle
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const x = cosPhi * sinTheta;
      const y = cosTheta;
      const z = sinPhi * sinTheta;

      const u = lon / lonBands;
      const v = lat / latBands;

      vertices.push(radius * x, radius * y, radius * z);
      normals.push(x, y, z);
      texCoords.push(u, v);
    }
  }

  for (let lat = 0; lat < latBands; ++lat) {
    for (let lon = 0; lon < lonBands; ++lon) {
      const first = lat * (lonBands + 1) + lon;
      const second = first + lonBands + 1;

      indices.push(first, second, first + 1);
      indices.push(second, second + 1, first + 1);
    }
  }

  return { vertices, indices, texCoords, normals };
}

const { vertices, indices, texCoords } = createSphere(1, 30, 30);

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
  size: indices.length * 4,
  usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  mappedAtCreation: true,
});
new Uint32Array(indexBuffer.getMappedRange()).set(indices);
indexBuffer.unmap();

// Create Texture Coordinates Buffer
const texCoordBuffer = device.createBuffer({
  label: "texture coordinates buffer",
  size: texCoords.length * 4,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  mappedAtCreation: true,
});
new Float32Array(texCoordBuffer.getMappedRange()).set(texCoords);
texCoordBuffer.unmap();

// Uniform Buffer
const uniformBuffer = device.createBuffer({
  label: "uniform coordinates buffer",
  size: 16 * Float32Array.BYTES_PER_ELEMENT, // Matrix4x4
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

function webGPUTextureFromImageBitmapOrCanvas(
  gpuDevice: GPUDevice,
  source: ImageBitmap,
) {
  const textureDescriptor = {
    // Unlike in WebGL, the size of our texture must be set at texture creation time.
    // This means we have to wait until the image is loaded to create the texture, since we won't
    // know the size until then.
    label: `texture element ${source}`,
    size: { width: source.width, height: source.height },
    format: "rgba8unorm" as GPUTextureFormat,
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  };
  const texture = gpuDevice.createTexture(textureDescriptor);

  gpuDevice.queue.copyExternalImageToTexture(
    { source },
    { texture },
    textureDescriptor.size,
  );

  return texture;
}

async function webGPUTextureFromImageUrl(gpuDevice: GPUDevice, url: string) {
  const response = await fetch(url);
  const blob = await response.blob();
  const imgBitmap = await createImageBitmap(blob);

  return webGPUTextureFromImageBitmapOrCanvas(gpuDevice, imgBitmap);
}
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

const NEAR_FRUSTUM = 0.1;
const FAR_FRUSTUM = 100;

setupPointerEvents(canvas);

function frame() {
  const projectionMatrix = mat4.perspective(
    mat4.create(),
    Math.PI / 4,
    canvas.width / canvas.height,
    NEAR_FRUSTUM,
    FAR_FRUSTUM,
  );

  const viewMatrix = mat4.lookAt(
    mat4.create(),
    [0, 0, scale],
    [-offsetX, offsetY, 0],
    [0, 1, 0],
  );

  const modelMatrix = mat4.rotateY(
    mat4.create(),
    mat4.create(),
    rotationAngleX,
  );
  mat4.rotateX(modelMatrix, modelMatrix, rotationAngleY);

  const mvpMatrix = mat4.multiply(
    mat4.create(),
    projectionMatrix,
    mat4.multiply(mat4.create(), viewMatrix, modelMatrix),
  );

  // Update MVP Matrix
  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(mvpMatrix));

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
  // renderPass.draw(vertices.length);
  renderPass.end();

  // Submit Commands
  device.queue.submit([commandEncoder.finish()]);

  // Request Next Frame
  requestAnimationFrame(frame);
}

export const initPlanet = () => {
  requestAnimationFrame(frame);
};
