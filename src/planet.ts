import { MAT4X4_BYTE_LENGTH, WORKGROUP_SIZE } from "./constants";
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
import { mat4, vec3, vec4 } from "gl-matrix";
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

///
const settings = {
  planets: 5,
  eccentricity: 0.7,
  ellipse_a: 10,
  armor: false,
  tail: false,
};
const setupUI = () => {
  const gui = new GUI();
  gui.add(settings, "planets", 1, 12000).step(1); // 12K is not a rookie number in this racket. No need to pump it!
  gui.add(settings, "eccentricity", 0.01, 0.99).step(0.01);
  gui.add(settings, "ellipse_a", 1, 100).step(1);
  gui.add(settings, "armor");
  gui.add(settings, "tail");
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

//// VERTEX AND FRAGMENT SHADER STUFF ///////
//
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
  primitive: { topology: "triangle-list" }, // Change this to `point-list` to have a "see-through"
  depthStencil: {
    format: "depth24plus",
    depthWriteEnabled: true,
    depthCompare: "less",
  },
});

// Armor pipeline
const armorPipeline = device.createRenderPipeline({
  label: "armor render pipeline",
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
    entryPoint: "armor_fragment",
    targets: [{ format }],
  },
  primitive: { topology: "point-list" },
  depthStencil: {
    format: "depth24plus",
    depthWriteEnabled: true,
    depthCompare: "less",
  },
});

// Bind group for the tail rendering
const tailBindGroupLayout = device.createBindGroupLayout({
  label: "tail bind group layout",
  entries: [
    {
      binding: 0, // View-Projection matrix buffer
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        type: "uniform",
      },
    },
  ],
});

// Tail pipeline
const tailPipeline = device.createRenderPipeline({
  label: "tail render pipeline",
  layout: device.createPipelineLayout({
    bindGroupLayouts: [tailBindGroupLayout],
  }),
  vertex: {
    module: shaderModule,
    entryPoint: "planet_tail_vertex",
    buffers: [
      {
        arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT, // 3 center position
        attributes: [
          {
            shaderLocation: 0,
            format: "float32x3",
            offset: 0,
          },
        ],
      },
    ],
  },
  fragment: {
    module: shaderModule,
    entryPoint: "planet_tail_fragment",
    targets: [{ format }],
  },
  primitive: { topology: "point-list" },
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

type PlanetInfo = {
  vertexBuffer: GPUBuffer; // position and texCoords
  indexBuffer: GPUBuffer;
  indices: number[];
  texture?: GPUTexture;
  radius: number;
};

const createPlanetAndItsBuffers = ({
  radius = 1,
  latBands = 40,
  longBands = 40,
}: {
  radius?: number;
  latBands?: number;
  longBands?: number;
}): PlanetInfo => {
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
    radius,
  };
};

// Fill in all uniform MVP matrices beforehand so you don't have to
// `device.queue.writeBuffer` (or direct mapping) for each one of the planets.
let allModelMatrices = new Float32Array(
  (modelMatrixUniformBufferSize * settings.planets) /
    Float32Array.BYTES_PER_ELEMENT,
);

const setModelMatrixUniformBuffer = (): GPUBuffer => {
  const rotation = new Date().getTime() * 0.0001;

  allModelMatrices = new Float32Array(
    (modelMatrixUniformBufferSize * settings.planets) /
      Float32Array.BYTES_PER_ELEMENT,
  );

  let previousTranslation: vec3 = [0, 0, 0];
  for (let i = 0; i < settings.planets; i++) {
    const { x, y, z } = calculateXYZEllipseCoordinates({
      degreeAngle: i % 360,
      ellipse_a: settings.ellipse_a,
      ellipse_eccentricity: settings.eccentricity,
    });

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
const planetsBuffers: PlanetInfo[] = [];
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
      radius,
      texture,
    });
  }
};
createPlanets(settings.planets);

type PlanetCenterPointAndRadius = {
  x: number;
  y: number;
  z: number;
  radius: number;
};
const PLANET_INITIAL_CENTER: vec4 = [0, 0, 0, 1];
const getPlanetsCenterPointAndRadius =
  (): Array<PlanetCenterPointAndRadius> => {
    const planetsCenterPointAndRadius: Array<PlanetCenterPointAndRadius> = [];

    // Get all current center point (in world space, after model matrix is applied) of each planet, along with its radius
    for (let i = 0; i < settings.planets; i++) {
      const dynamicOffset = i * modelMatrixUniformBufferSize;

      const { radius } = planetsBuffers[i];

      let modelMatrix = allModelMatrices.subarray(
        dynamicOffset / 4,
        dynamicOffset / 4 + MAT4X4_BYTE_LENGTH,
      );

      let planetCenterPositionOnScreen: vec4 = vec4.transformMat4(
        vec4.create(),
        PLANET_INITIAL_CENTER,
        modelMatrix,
      );

      planetsCenterPointAndRadius.push({
        x: planetCenterPositionOnScreen[0],
        y: planetCenterPositionOnScreen[1],
        z: planetCenterPositionOnScreen[2],
        radius,
      });
    }

    return planetsCenterPointAndRadius;
  };

const renderPlanets = async () => {
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
        { binding: 3, resource: texture!.createView() },
      ],
    });

    renderPass.setPipeline(pipeline);
    renderPass.setVertexBuffer(0, vertexBuffer); // position and texCoords
    renderPass.setIndexBuffer(indexBuffer, "uint32");
    renderPass.setBindGroup(0, bindGroup, [dynamicOffset]);
    renderPass.drawIndexed(indices.length);

    if (settings.armor) {
      renderPass.setPipeline(armorPipeline);
      renderPass.drawIndexed(indices.length);
    }
  }
};

let tailVertexBuffer: GPUBuffer;
let tailCenterPositions: vec3[] = [];
const updateVariableTailBuffers = () => {
  // Get center points
  const planetsCenter = getPlanetsCenterPointAndRadius().map((item) =>
    vec3.fromValues(item.x, item.y, item.z),
  );
  tailCenterPositions.push(...planetsCenter);

  // Create/Update Position (VERTEX BUFFER)
  tailVertexBuffer = device.createBuffer({
    label: "tail vertices buffer",
    size: tailCenterPositions.length * 3 * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(tailVertexBuffer.getMappedRange()).set(
    tailCenterPositions.map((a) => [...a]).flat() as number[],
  );
  tailVertexBuffer.unmap();
};
updateVariableTailBuffers();

const renderTail = ({ currentFrame }: { currentFrame: number }) => {
  // Only calculate the tail center position every so often
  if (currentFrame % 60 === 0 || tailCenterPositions.length === 0) {
    updateVariableTailBuffers();
  }

  // this depends on the view projection (camera) matrix,
  // so it needs to be checked almost all the time because
  // we don't know (we could, but not now) either the camera
  // has changed or not (translated, rotated)
  const tailBindGroup = device.createBindGroup({
    label: "tail bind group element",
    layout: tailPipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: viewProjectionMatrixUniformBuffer,
        },
      },
    ],
  });

  renderPass.setPipeline(tailPipeline);
  renderPass.setVertexBuffer(0, tailVertexBuffer);
  renderPass.setBindGroup(0, tailBindGroup);
  renderPass.draw(tailCenterPositions.length);
};

//// COMPUTE SHADER STUFF //////
//
// Bind Group for the compute shader
const computeShaderBindGroupLayout = device.createBindGroupLayout({
  label: "compute shader custom bind group layout",
  entries: [
    {
      binding: 0, // Planets center point in world space + radius
      visibility: GPUShaderStage.COMPUTE,
      buffer: {
        type: "read-only-storage",
      },
    },
    {
      binding: 1, // collisions
      visibility: GPUShaderStage.COMPUTE,
      buffer: {
        type: "storage",
      },
    },
  ],
});

// Compute shader pipeline
const computeShaderPipeline = device.createComputePipeline({
  label: "compute shader render pipeline",
  layout: device.createPipelineLayout({
    bindGroupLayouts: [computeShaderBindGroupLayout],
  }),
  compute: {
    module: shaderModule,
    entryPoint: "compute_collision",
  },
});

let planetsCenterPointAndRadiusBuffer: GPUBuffer;
let collisionsBuffer: GPUBuffer;
let resultsBuffer: GPUBuffer;
let computeShaderBindGroup: GPUBindGroup;

const recreateComputeShaderBuffers = (numberOfPlanets: number) => {
  const planetsCenterPoint = getPlanetsCenterPointAndRadius().map((item) =>
    vec4.fromValues(item.x, item.y, item.z, item.radius),
  );

  planetsCenterPointAndRadiusBuffer = device.createBuffer({
    label: "compute shader planets center points and radius buffer",
    size: numberOfPlanets * Float32Array.BYTES_PER_ELEMENT * 4, // x, y, z, r
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  // INFO: This should be the "correct" way of calculating how many possible
  // collisions there area, but this number grows a lot after some time, which
  // makes it incalculable and not efficient for this application. It is also
  // very unlikely that all the planets will collided with all of them (think of
  // all planets being in a single place).
  //
  // One of the possible solutions is to maintain the size of `numberOfPlanets`
  // and then destroy those collided planets, so in the next `checkCollision`
  // iteration they will not exist, giving space for the other collided planets
  // to be checked.
  //
  // The total amount of collision that can exist in the system is given by the
  // formula (simple combination):
  //                          C(n,k)=n!/k!(n-k)!
  // where:
  //              0 <= k <= n
  //
  //              n: number of elements (in our case number of planets)
  //              k: unique k-selections (in our case 2, as we are checking
  //                                the collision from one planet to another)
  //
  // const collisionBufferSize =
  //   calculateFactorial(numberOfPlanets) /
  //   (2 * calculateFactorial(numberOfPlanets - 2));

  collisionsBuffer = device.createBuffer({
    label: "compute shader collision buffer",
    size: numberOfPlanets * 4 * 2 + 4, // (a: u32, b: u32) * planets + count: 32
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_SRC |
      GPUBufferUsage.COPY_DST, // INFO: COPY_DST is used for the command encoder to clear the buffer after it is copied into resultsBuffer
  });

  resultsBuffer = device.createBuffer({
    label: "compute shader result buffer",
    size: collisionsBuffer.size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  computeShaderBindGroup = device.createBindGroup({
    label: "compute shader bindGroup",
    layout: computeShaderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: planetsCenterPointAndRadiusBuffer } },
      { binding: 1, resource: { buffer: collisionsBuffer } },
    ],
  });

  device.queue.writeBuffer(
    planetsCenterPointAndRadiusBuffer,
    0,
    new Float32Array(planetsCenterPoint.map((a) => [...a]).flat() as number[]),
  );
};

interface CollisionPair {
  a: number;
  b: number;
}

const parseResultsBuffer = (arrayBuffer: ArrayBuffer, label: string) => {
  const view = new DataView(arrayBuffer.slice(4)); // remove `count`
  const structSize = 2 * 4; // CollisionPair (a: number, b: number)

  const collisions: CollisionPair[] = [];
  for (let i = 0; i < Math.floor(view.byteLength / structSize); i++) {
    const baseOffset = i * structSize;
    const a = view.getUint32(baseOffset, true); // a
    const b = view.getUint32(baseOffset + 4, true); // b

    // INFO: the Collision structure in the shader will have the size of
    // the number of planets. Therefore, if we have less actual collisions than
    // that number, it is using the default value (0).
    // TODO: Check the copyBuffer part. That might do the trick.
    if (a !== b) {
      collisions.push({ a, b });
    }
  }

  console.log(label, collisions);
};

const checkCollisionViaComputeShader = async ({
  numberOfPlanets,
  recreateBuffers = false,
}: {
  numberOfPlanets: number;
  recreateBuffers: boolean;
}) => {
  console.log("Checking collisions...");

  if (recreateBuffers) {
    recreateComputeShaderBuffers(numberOfPlanets);
  }

  // Create Command Encoder
  const computeShaderCommandEncoder = device.createCommandEncoder({
    label: "compute pass command encoder",
  });

  const computePass = computeShaderCommandEncoder.beginComputePass();
  computePass.setPipeline(computeShaderPipeline);
  computePass.setBindGroup(0, computeShaderBindGroup);

  // dispatch workgroups
  computePass.dispatchWorkgroups(Math.ceil(numberOfPlanets / WORKGROUP_SIZE));
  computePass.end();

  computeShaderCommandEncoder.copyBufferToBuffer(
    collisionsBuffer,
    0,
    resultsBuffer,
    0,
    resultsBuffer.size,
  );

  // clear collisions buffer
  computeShaderCommandEncoder.clearBuffer(collisionsBuffer);

  // Submit Commands
  device.queue.submit([computeShaderCommandEncoder.finish()]);

  await resultsBuffer.mapAsync(GPUMapMode.READ);
  const arrayBuffer = resultsBuffer.getMappedRange();

  // Parse the buffer into a structure
  parseResultsBuffer(arrayBuffer, "collisions");

  // release buffer
  resultsBuffer.unmap();
};

/// Variables to check for conditional rendering
// INFO: this variable is NOT updated automatically when settings.planets change.
let currentPlanets = settings.planets;
// INFO: this is different because the compute shader does not run on every frame
let currentPlanetsForComputeShader = settings.planets;
// INFO: this also is NOT when rotation angles change
let currentCameraConfigurations: PointerEventsTransformations = {
  ...pointerEvents,
};

let currentFrame = 0;
// Renders on the same frame must use the same render pass, otherwise
// it switches (either one or the other, not both)
let renderPass: GPURenderPassEncoder;
function frame() {
  stats.begin();

  // Update Texture View
  passDescriptor.colorAttachments[0].view = context
    .getCurrentTexture()
    .createView();

  const commandEncoder = device.createCommandEncoder({
    label: "vertex/fragment shaders common command encoder",
  });
  // Create a render pass that is common to all renders,
  // be them vertex/fragment shaders (not compute shaders)
  renderPass = commandEncoder.beginRenderPass(passDescriptor);

  // Only recalculate View-Projection matrix if the camera position has changed.
  if (hasCameraChangedPositions(currentCameraConfigurations, pointerEvents)) {
    calculateAndSetViewProjectionMatrix(pointerEvents);
    currentCameraConfigurations = { ...pointerEvents };
  }

  // Only create new planets if we change the settings.planets UI variable
  const numberOfPlanetsChanged = currentPlanets !== settings.planets;
  if (numberOfPlanetsChanged) {
    createPlanets(settings.planets);
    currentPlanets = settings.planets;
  }

  // Render the planets
  renderPlanets();

  // Render the tail (if setting is activated)
  if (settings.tail) {
    renderTail({ currentFrame });
  }

  // Cleanup the tailCenterPositions array when we deactivate the tail setting
  if (!settings.tail && tailCenterPositions.length > 0) {
    tailCenterPositions = [];
  }

  // Create the compute shader buffers as soon as we start the
  // application and after we rendered planets
  if (currentFrame === 0) {
    recreateComputeShaderBuffers(settings.planets);
  }

  // Only check for collisions every so often
  // TODO: change to a meaningful number
  if (currentFrame % 1233 === 0) {
    checkCollisionViaComputeShader({
      numberOfPlanets: settings.planets,
      recreateBuffers: currentPlanetsForComputeShader !== settings.planets,
    });
    currentPlanetsForComputeShader = settings.planets;
  }
  currentFrame++;

  // Finalise render pass (common to all vertex/fragment shaders, not compute shader)
  renderPass.end();

  // Submit Commands
  device.queue.submit([commandEncoder.finish()]);

  stats.end();

  // Request Next Frame
  requestAnimationFrame(frame);
}

export const initPlanet = () => {
  requestAnimationFrame(frame);
};
