import {
  CAMERA_UP,
  CHECK_COLLISION_FREQUENCY,
  MAT4X4_BYTE_LENGTH,
} from "./constants";
import {
  createSphereMesh,
  getPlanetsCenterPointAndRadius,
  getViewProjectionMatrix,
  hasCameraChangedPositions,
  PointerEventsCallbackData,
  PointerEventsTransformations,
  setupPointerEvents,
} from "./utils";
import { initWebGPUAndCanvas } from "./webgpu";
import { vec3, vec4 } from "gl-matrix";
import { PlanetTextures } from "./textures";
import planetWGSL from "./shaders/planet.wgsl?raw";
import Stats from "stats.js";
import { SettingsType, setupUI, uiSettings } from "./ui";
import { PlanetInfo } from "./types";
import { Collisions } from "./collision";
import { Tail } from "./tail";
import { Render } from "./render";

const stats = new Stats();

stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom);

/// Load canvas and GPU devices
/// If the user/browser doesn't have working WebGPU yet, this will throw early.
const { canvas, context, device, format } = await initWebGPUAndCanvas();

const perspectiveAspectRatio = canvas.width / canvas.height;

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

// Depth Buffer
const depthTexture = device.createTexture({
  label: "depth texture",
  size: [canvas.width, canvas.height],
  format: "depth24plus",
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
});

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
    cameraUp: CAMERA_UP,
    perspectiveAspectRatio,
  });

  new Float32Array(viewProjectionMatrixUniformBuffer.getMappedRange()).set(
    viewProjectionMatrix,
  );
  viewProjectionMatrixUniformBuffer.unmap();
};
calculateAndSetViewProjectionMatrix(pointerEvents);

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

/// INFO: One point about this: it is saving the planets' state in memory (planetsBuffer array)
/// Therefore in the case that we select to render less planets than we currently have,
/// it will still keep those states in memory.
/// This is a trade-off between saving this states in memory or re-creating them.
///
let planetsBuffers: PlanetInfo[] = [];
export const createPlanets = ({
  numberOfPlanets,
  radius,
  addNew,
}: {
  numberOfPlanets: number;
  radius?: number;
  addNew?: boolean;
}) => {
  if (addNew) {
    setNumberOfPlanets(getNumberOfPlanets() + numberOfPlanets);
    uiSettings.planets = getNumberOfPlanets();
    planetsGUIListener.updateDisplay();
  }

  for (let i = 0; i < numberOfPlanets; i++) {
    // TODO: improve this. It is commented out because of
    // the change in the latBands and lonBands uiSettings
    // if (i < planetsBuffers.length - 1) {
    //   continue;
    // }

    radius = radius ?? Math.random() * 2 + 1;

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
createPlanets({ numberOfPlanets: uiSettings.planets });

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

/// Render the planets
const {
  renderPlanets,
  getModelMatrixUniformBufferSize,
  getAllModelMatrices,
  setNumberOfPlanets,
  getNumberOfPlanets,
} = Render({
  device,
  shaderModule,
  format,
  numberOfPlanets: uiSettings.planets,
});

/// Variables to check for conditional rendering
// INFO: this is different because the compute shader does not run on every frame
let currentPlanetsForComputeShader = uiSettings.planets;
// INFO: this variavble does not update automatically when rotation angles change
let currentCameraConfigurations: PointerEventsTransformations = {
  ...pointerEvents,
};

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

let currentFrame = 1;

const resetTailVariables = () => {
  resetTailCenterPositionsComplete();
  resetCoordinatesPerPlanet();
};
const updatePlanetsForComputeShaderCollision = () => {
  if (!uiSettings.checkCollisions) {
    return;
  }

  planetsCenterPointsAndRadius = getPlanetsCenterPointAndRadius({
    numberOfPlanets: getNumberOfPlanets(),
    planetsBuffers,
    modelMatrixUniformBufferSize: getModelMatrixUniformBufferSize(),
    allModelMatrices: getAllModelMatrices(),
  }).map((item) => vec4.fromValues(item.x, item.y, item.z, item.radius));

  recreateComputeShaderBuffers({
    numberOfPlanets: getNumberOfPlanets(),
    planetsCenterPointsAndRadius,
  });
};
const uiCallback = (type: SettingsType, value?: unknown) => {
  switch (type) {
    case "planets": {
      setNumberOfPlanets(value as number);
      createPlanets({ numberOfPlanets: value as number });

      if (uiSettings.tail) {
        resetTailVariables();
        updateVariableTailBuffers({
          numberOfPlanets: value as number,
          planetsBuffers,
          modelMatrixUniformBufferSize: getModelMatrixUniformBufferSize(),
          allModelMatrices: getAllModelMatrices(),
        });
      }
      break;
    }
    case "eccentricity": {
      updatePlanetsForComputeShaderCollision();
      break;
    }
    case "ellipse_a": {
      updatePlanetsForComputeShaderCollision();
      break;
    }
    case "armor": {
      break;
    }
    case "tail": {
      if (!value) {
        resetTailVariables();
      } else {
        updateVariableTailBuffers({
          numberOfPlanets: value as number,
          planetsBuffers,
          modelMatrixUniformBufferSize: getModelMatrixUniformBufferSize(),
          allModelMatrices: getAllModelMatrices(),
        });
      }

      break;
    }
    case "checkCollisions": {
      updatePlanetsForComputeShaderCollision();
      break;
    }
    case "topology": {
      updatePlanetsForComputeShaderCollision();
      break;
    }
    case "latBands": {
      createPlanets({ numberOfPlanets: getNumberOfPlanets() });
      updatePlanetsForComputeShaderCollision();
      break;
    }
    case "longBands": {
      createPlanets({ numberOfPlanets: getNumberOfPlanets() });
      updatePlanetsForComputeShaderCollision();
      break;
    }
  }
};
// FIXME: because we are using the `listen()` on planets,
// it is not allowing us to change the number of planets in the UI
// via the keyboard (only slider works)
const { planetsGUIListener } = setupUI({ callback: uiCallback });

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
  renderPlanets({
    renderPass,
    enableArmor: uiSettings.armor,
    ellipse_a: uiSettings.ellipse_a,
    eccentricity: uiSettings.eccentricity,
    topology: uiSettings.topology,
    viewProjectionMatrixUniformBuffer,
    planetsBuffers,
  });

  // Render the tail (if setting is activated)
  if (uiSettings.tail) {
    renderTail({
      currentFrame,
      numberOfPlanets: getNumberOfPlanets(),
      planetsBuffers,
      modelMatrixUniformBufferSize: getModelMatrixUniformBufferSize(),
      allModelMatrices: getAllModelMatrices(),
      viewProjectionMatrixUniformBuffer,
      renderPass,
    });
  }

  // Only check for collisions every so often
  if (
    currentFrame % CHECK_COLLISION_FREQUENCY === 0 &&
    uiSettings.checkCollisions
  ) {
    planetsCenterPointsAndRadius = getPlanetsCenterPointAndRadius({
      numberOfPlanets: getNumberOfPlanets(),
      planetsBuffers,
      modelMatrixUniformBufferSize: getModelMatrixUniformBufferSize(),
      allModelMatrices: getAllModelMatrices(),
    }).map((item) => vec4.fromValues(item.x, item.y, item.z, item.radius));

    checkCollisionViaComputeShader({
      numberOfPlanets: getNumberOfPlanets(),
      recreateBuffers: currentPlanetsForComputeShader !== getNumberOfPlanets(),
      planetsCenterPointsAndRadius,
    });
    currentPlanetsForComputeShader = getNumberOfPlanets();
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
