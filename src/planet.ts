import {
  CAMERA_UP,
  CHECK_COLLISION_FREQUENCY,
  MAT4X4_BYTE_LENGTH,
} from "./constants";
import {
  createSphereMesh,
  getPlanetsCenterPointAndRadius,
  getViewProjectionMatrix,
} from "./utils";
import { initWebGPUAndCanvas } from "./webgpu";
import { vec3, vec4 } from "gl-matrix";
import { PlanetTextures } from "./textures";
import planetWGSL from "./shaders/planet.wgsl?raw";
import Stats from "stats.js";
import { SetupUI, UI_SETTINGS } from "./ui";
import { CollisionPair, PlanetInfo } from "./types";
import { Collisions } from "./collision";
import { Tail } from "./tail";
import { Render } from "./render";
import { Observer } from "./observer";
import {
  DEFAULT_POINTER_EVENTS,
  PointerEventsTransformations,
  SetupPointerEvents,
} from "./pointerEvents";

/// Setup observers
const OBSERVER_ID = "planet.ts";
const resetTailVariables = () => {
  resetTailCenterPositionsComplete();
  resetCoordinatesPerPlanet();
};
const updatePlanetsForComputeShaderCollision = () => {
  if (!UI_SETTINGS.enableCollisions) {
    return;
  }

  const planetsCenterPointsAndRadius = getPlanetsCenterPointAndRadius({
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
(() => {
  const observer = Observer();

  observer.subscribe("planets", {
    id: OBSERVER_ID,
    callback: (planets) => {
      createPlanets({ numberOfPlanets: planets as number });

      if (UI_SETTINGS.enableTail) {
        resetTailVariables();
        updateVariableTailBuffers({
          numberOfPlanets: planets as number,
          planetsBuffers,
          modelMatrixUniformBufferSize: getModelMatrixUniformBufferSize(),
          allModelMatrices: getAllModelMatrices(),
        });
      }
    },
  });

  observer.subscribe("renderPlanets", {
    id: OBSERVER_ID,
    callback: (_renderPlanets) => {
      renderPlanets({
        renderPass,
        enableArmor: UI_SETTINGS.enableArmor,
        ellipse_a: UI_SETTINGS.ellipseA,
        eccentricity: UI_SETTINGS.eccentricity,
        topology: UI_SETTINGS.topology,
        viewProjectionMatrixUniformBuffer,
        planetsBuffers,
      });
    },
  });

  observer.subscribe("eccentricity", {
    id: OBSERVER_ID,
    callback: (_eccentricity) => {
      updatePlanetsForComputeShaderCollision();
    },
  });

  observer.subscribe("ellipseA", {
    id: OBSERVER_ID,
    callback: (_eccentricity) => {
      updatePlanetsForComputeShaderCollision();
    },
  });

  observer.subscribe("enableTail", {
    id: OBSERVER_ID,
    callback: (enableTail) => {
      if (!enableTail) {
        resetTailVariables();
      } else {
        updateVariableTailBuffers({
          numberOfPlanets: getNumberOfPlanets(),
          planetsBuffers,
          modelMatrixUniformBufferSize: getModelMatrixUniformBufferSize(),
          allModelMatrices: getAllModelMatrices(),
        });
      }
    },
  });

  observer.subscribe("renderTail", {
    id: OBSERVER_ID,
    callback: (_renderTail) => {
      renderTail({
        currentFrame,
        numberOfPlanets: getNumberOfPlanets(),
        planetsBuffers,
        modelMatrixUniformBufferSize: getModelMatrixUniformBufferSize(),
        allModelMatrices: getAllModelMatrices(),
        viewProjectionMatrixUniformBuffer,
        renderPass,
      });
    },
  });

  observer.subscribe("enableCollisions", {
    id: OBSERVER_ID,
    callback: (_enableCollisions) => {
      updatePlanetsForComputeShaderCollision();
    },
  });

  observer.subscribe("topology", {
    id: OBSERVER_ID,
    callback: (_topology) => {
      updatePlanetsForComputeShaderCollision();
    },
  });

  observer.subscribe("latBands", {
    id: OBSERVER_ID,
    callback: (_latBands) => {
      createPlanets({ numberOfPlanets: getNumberOfPlanets() });
      updatePlanetsForComputeShaderCollision();
    },
  });

  observer.subscribe("longBands", {
    id: OBSERVER_ID,
    callback: (_longBands) => {
      createPlanets({ numberOfPlanets: getNumberOfPlanets() });
      updatePlanetsForComputeShaderCollision();
    },
  });

  observer.subscribe("collisions", {
    id: OBSERVER_ID,
    callback: (collisions) => {
      // Create a new planet for each collision found.
      createPlanets({
        numberOfPlanets: (collisions as CollisionPair[]).length,
        radius: 3,
        addNew: true,
      });
    },
  });

  observer.subscribe("checkCollisions", {
    id: OBSERVER_ID,
    callback: (_checkCollisions) => {
      checkCollisionViaComputeShader({
        numberOfPlanets: getNumberOfPlanets(),
      });
    },
  });

  observer.subscribe("pointerEvents", {
    id: OBSERVER_ID,
    callback: (pointerEvents) => {
      // Only recalculate View-Projection matrix if the camera position has changed.
      calculateAndSetViewProjectionMatrix(
        pointerEvents as PointerEventsTransformations,
      );
    },
  });
})();

/// FPS Stats
const stats = new Stats();
stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom);

/// Load canvas and GPU devices
/// If the user/browser doesn't have working WebGPU yet, this will throw early.
const { canvas, context, device, format } = await initWebGPUAndCanvas();

const perspectiveAspectRatio = canvas.width / canvas.height;

/// Setup pointer events
SetupPointerEvents(canvas);

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
calculateAndSetViewProjectionMatrix(DEFAULT_POINTER_EVENTS);

const createPlanetAndItsBuffers = ({
  radius = 1,
}: {
  radius?: number;
}): PlanetInfo => {
  const { positionAndTexCoords, indices } = createSphereMesh({
    radius,
    latBands: UI_SETTINGS.latBands,
    longBands: UI_SETTINGS.longBands,
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
    Observer().notify("planets", getNumberOfPlanets() + numberOfPlanets);
    UI_SETTINGS.planets = getNumberOfPlanets();
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
createPlanets({ numberOfPlanets: UI_SETTINGS.planets });

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
  getNumberOfPlanets,
} = Render({
  device,
  shaderModule,
  format,
  numberOfPlanets: UI_SETTINGS.planets,
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

let currentFrame = 1;

// FIXME: because we are using the `listen()` on planets,
// it is not allowing us to change the number of planets in the UI
// via the keyboard (only slider works)
const { planetsGUIListener } = SetupUI();

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

  // Render the planets
  Observer().notify("renderPlanets", true);

  // Render the tail (if setting is activated)
  if (UI_SETTINGS.enableTail) {
    Observer().notify("renderTail", true);
  }

  // Only check for collisions every so often
  if (
    currentFrame % CHECK_COLLISION_FREQUENCY === 0 &&
    UI_SETTINGS.enableCollisions
  ) {
    Observer().notify("checkCollisions", true);
  }

  // Finalise render pass (common to all vertex/fragment shaders, not compute shader)
  renderPass.end();

  // Submit Commands
  device.queue.submit([commandEncoder.finish()]);

  // Update current frame
  currentFrame++;

  stats.end();

  // Request Next Frame
  requestAnimationFrame(frame);
}

export const initPlanet = () => {
  requestAnimationFrame(frame);
};
