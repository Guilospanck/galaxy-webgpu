import {
  CHECK_COLLISION_FREQUENCY,
  FULL_CIRCUMFERENCE,
  MAT4X4_BYTE_LENGTH,
  ROTATION_SPEED_SENSITIVITY,
  TopologyEnum,
  TRANSLATION_SPEED_SENSITIVITY,
} from "./constants";
import {
  calculateXYZEllipseCoordinates,
  createSphereMesh,
  getModelMatrix,
  getPlanetsCenterPointAndRadius,
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
import { SettingsType, setupUI, uiSettings } from "./ui";
import { PlanetInfo } from "./types";
import { Collisions } from "./collision";
import { Tail } from "./tail";

const stats = new Stats();

stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom);

/// Load canvas and GPU devices
/// If the user/browser doesn't have working WebGPU yet, this will throw early.
const { canvas, context, device, format } = await initWebGPUAndCanvas();

const perspectiveAspectRatio = canvas.width / canvas.height;
const emptyVector: vec3 = [0, 0, 0];
const cameraUp: vec3 = [0, 1, 0];

let currentFrame = 0;

/// UI Settings
// Every time the GUI changes, we want to reset the currentFrame count
// It is as if the frame had just began.
const resetCurrentFrame = () => {
  currentFrame = 0;
};
const resetTailVariables = () => {
  resetTailCenterPositionsComplete();
  resetCoordinatesPerPlanet();
};
const commonSettingsOnChange = () => {
  resetCurrentFrame();
};
const uiCallback = (type: SettingsType, value?: unknown) => {
  switch (type) {
    case "planets": {
      createPlanets(value as number);
      if (uiSettings.tail) {
        resetTailVariables();
        updateVariableTailBuffers({
          numberOfPlanets: value as number,
          planetsBuffers,
          modelMatrixUniformBufferSize,
          allModelMatrices,
        });
      }
      resetCurrentFrame();
      break;
    }
    case "eccentricity": {
      commonSettingsOnChange();
      break;
    }
    case "ellipse_a": {
      commonSettingsOnChange();
      break;
    }
    case "armor": {
      commonSettingsOnChange();
      break;
    }
    case "tail": {
      if (!value) {
        resetTailVariables();
      } else {
        updateVariableTailBuffers({
          numberOfPlanets: value as number,
          planetsBuffers,
          modelMatrixUniformBufferSize,
          allModelMatrices,
        });
      }

      resetCurrentFrame();
      break;
    }
    case "checkCollisions": {
      commonSettingsOnChange();
      break;
    }
    case "topology": {
      commonSettingsOnChange();
      break;
    }
    case "latBands": {
      createPlanets(uiSettings.planets);
      commonSettingsOnChange();
      break;
    }
    case "longBands": {
      createPlanets(uiSettings.planets);
      commonSettingsOnChange();
      break;
    }
  }
};
setupUI({ callback: uiCallback });

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

const baseRenderPipeline: GPURenderPipelineDescriptor = {
  label: "render pipeline",
  layout: device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  }),
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
  depthStencil: {
    format: "depth24plus",
    depthWriteEnabled: true,
    depthCompare: "less",
  },
};

// Pipelines based on topology
const triangleListRenderPipeline = device.createRenderPipeline({
  ...baseRenderPipeline,
  primitive: { topology: TopologyEnum.TRIANGLE_LIST }, // Change this to `point-list` to have a "see-through"
});
const pointListRenderPipeline = device.createRenderPipeline({
  ...baseRenderPipeline,
  primitive: { topology: TopologyEnum.POINT_LIST }, // Change this to `point-list` to have a "see-through"
});
const lineListRenderPipeline = device.createRenderPipeline({
  ...baseRenderPipeline,
  primitive: { topology: TopologyEnum.LINE_LIST }, // Change this to `point-list` to have a "see-through"
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
  const cameraEye: vec3 = [-offsetX, offsetY, scale];
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

const createPlanetAndItsBuffers = ({
  radius = 1,
}: {
  radius?: number;
}): PlanetInfo => {
  const { positionAndTexCoords, indices } = createSphereMesh({
    radius,
    latBands: uiSettings.latBands,
    longBands: uiSettings.longBands,
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
  (modelMatrixUniformBufferSize * uiSettings.planets) /
    Float32Array.BYTES_PER_ELEMENT,
);

const lastAngleForPlanet: Record<number, number> = {};
const setModelMatrixUniformBuffer = (): GPUBuffer => {
  const rotation = new Date().getTime() * ROTATION_SPEED_SENSITIVITY;

  allModelMatrices = new Float32Array(
    (modelMatrixUniformBufferSize * uiSettings.planets) /
      Float32Array.BYTES_PER_ELEMENT,
  );

  let previousTranslation: vec3 = [0, 0, 0];
  for (let i = 0; i < uiSettings.planets; i++) {
    const angle = ((lastAngleForPlanet[i] ?? 0) + 1) % FULL_CIRCUMFERENCE;
    lastAngleForPlanet[i] = angle;

    const { x, y, z } = calculateXYZEllipseCoordinates({
      degreeAngle: angle,
      ellipse_a: uiSettings.ellipse_a,
      ellipse_eccentricity: uiSettings.eccentricity,
    });

    previousTranslation = vec3.add(emptyVector, previousTranslation, [x, y, z]);

    const translation =
      new Date().getTime() * TRANSLATION_SPEED_SENSITIVITY + i;

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
    size: modelMatrixUniformBufferSize * uiSettings.planets,
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
let planetsBuffers: PlanetInfo[] = [];
const createPlanets = (numberOfPlanets: number) => {
  planetsBuffers = [];
  for (let i = 0; i < numberOfPlanets; i++) {
    // TODO: improve this. It is commented out because of
    // the change in the latBands and lonBands uiSettings
    // if (i < planetsBuffers.length - 1) {
    //   continue;
    // }

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
createPlanets(uiSettings.planets);

export const getPipelineBasedOnCurrentTopology = (
  topology: TopologyEnum,
): GPURenderPipeline => {
  switch (topology) {
    case TopologyEnum.LINE_LIST: {
      return lineListRenderPipeline;
    }
    case TopologyEnum.TRIANGLE_LIST: {
      return triangleListRenderPipeline;
    }
    case TopologyEnum.POINT_LIST: {
      return pointListRenderPipeline;
    }
  }
};

const renderPlanets = async () => {
  const modelMatrixUniformBuffer = setModelMatrixUniformBuffer();
  const pipeline = getPipelineBasedOnCurrentTopology(uiSettings.topology);

  for (let i = 0; i < uiSettings.planets; i++) {
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

    if (uiSettings.armor) {
      renderPass.setPipeline(armorPipeline);
      renderPass.drawIndexed(indices.length);
    }
  }
};

/// Collision computation
const { checkCollisionViaComputeShader, recreateComputeShaderBuffers } =
  Collisions({ device, shaderModule });

/// Tail computation
const {
  renderTail,
  resetCoordinatesPerPlanet,
  resetTailCenterPositionsComplete,
  updateVariableTailBuffers,
} = Tail({ device, shaderModule, format });

/// Variables to check for conditional rendering
// INFO: this is different because the compute shader does not run on every frame
let currentPlanetsForComputeShader = uiSettings.planets;
// INFO: this variavble does not update automatically when rotation angles change
let currentCameraConfigurations: PointerEventsTransformations = {
  ...pointerEvents,
};

// Renders on the same frame must use the same render pass, otherwise
// it switches (either one or the other, not both)
let renderPass: GPURenderPassEncoder;
let planetsCenterPointsAndRadius: vec4[] = [];
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

  // Render the planets
  renderPlanets();

  // Render the tail (if setting is activated)
  if (uiSettings.tail) {
    renderTail({
      currentFrame,
      numberOfPlanets: uiSettings.planets,
      planetsBuffers,
      modelMatrixUniformBufferSize,
      allModelMatrices,
      viewProjectionMatrixUniformBuffer,
      renderPass,
    });
  }

  if (
    (currentFrame === 0 && uiSettings.checkCollisions) ||
    (currentFrame % CHECK_COLLISION_FREQUENCY === 0 &&
      uiSettings.checkCollisions)
  ) {
    planetsCenterPointsAndRadius = getPlanetsCenterPointAndRadius({
      numberOfPlanets: uiSettings.planets,
      planetsBuffers,
      modelMatrixUniformBufferSize,
      allModelMatrices,
    }).map((item) => vec4.fromValues(item.x, item.y, item.z, item.radius));
  }

  // Create the compute shader buffers as soon as we start the
  // application and after we rendered planets
  if (currentFrame === 0 && uiSettings.checkCollisions) {
    recreateComputeShaderBuffers({
      numberOfPlanets: uiSettings.planets,
      planetsCenterPointsAndRadius,
    });
  }

  // Only check for collisions every so often
  if (
    currentFrame % CHECK_COLLISION_FREQUENCY === 0 &&
    uiSettings.checkCollisions
  ) {
    checkCollisionViaComputeShader({
      numberOfPlanets: uiSettings.planets,
      recreateBuffers: currentPlanetsForComputeShader !== uiSettings.planets,
      planetsCenterPointsAndRadius,
    });
    currentPlanetsForComputeShader = uiSettings.planets;
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
