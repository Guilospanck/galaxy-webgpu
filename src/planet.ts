import {
  CAMERA_UP,
  CHECK_COLLISION_FREQUENCY,
  MAT4X4_BYTE_LENGTH,
  RENDER_TAIL_FREQUENCY,
} from "./constants";
import {
  getPlanetsCenterPointAndRadius,
  getViewProjectionMatrix,
} from "./utils";
import { initWebGPUAndCanvas } from "./webgpu";
import { vec3, vec4 } from "gl-matrix";
import planetWGSL from "./shaders/planet.wgsl?raw";
import Stats from "stats.js";
import { SetupUI, UI_SETTINGS } from "./ui";
import { CollisionPair } from "./types";
import { Collisions } from "./collision";
import { Tail } from "./tail";
import { Render } from "./render";
import { Observer } from "./observer";
import {
  DEFAULT_POINTER_EVENTS,
  PointerEventsTransformations,
  SetupPointerEvents,
} from "./pointerEvents";
import { CreatePlanets } from "./createPlanets";

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
    planetsBuffers: getPlanetsBuffers(),
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
      createPlanets({
        planetsToCreate: planets as number,
        currentNumberOfPlanets: getNumberOfPlanets(),
      });

      if (UI_SETTINGS.enableTail) {
        resetTailVariables();
        updateVariableTailBuffers({
          numberOfPlanets: planets as number,
          planetsBuffers: getPlanetsBuffers(),
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
        planetsBuffers: getPlanetsBuffers(),
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
          planetsBuffers: getPlanetsBuffers(),
          modelMatrixUniformBufferSize: getModelMatrixUniformBufferSize(),
          allModelMatrices: getAllModelMatrices(),
        });
      }
    },
  });

  observer.subscribe("renderTail", {
    id: OBSERVER_ID,
    callback: (renderTailInfo) => {
      renderTail({
        numberOfPlanets: getNumberOfPlanets(),
        planetsBuffers: getPlanetsBuffers(),
        modelMatrixUniformBufferSize: getModelMatrixUniformBufferSize(),
        allModelMatrices: getAllModelMatrices(),
        viewProjectionMatrixUniformBuffer,
        renderPass,
        recalculateTailBuffer: (
          renderTailInfo as { recalculateTailBuffer: boolean }
        ).recalculateTailBuffer,
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

  // TODO: lat and longbands are only changing the `next` planets, not the current
  // ones in the planetsBuffers variable
  observer.subscribe("latBands", {
    id: OBSERVER_ID,
    callback: (_latBands) => {
      createPlanets({
        currentNumberOfPlanets: getNumberOfPlanets(),
      });
      updatePlanetsForComputeShaderCollision();
    },
  });

  observer.subscribe("longBands", {
    id: OBSERVER_ID,
    callback: (_longBands) => {
      createPlanets({
        currentNumberOfPlanets: getNumberOfPlanets(),
      });
      updatePlanetsForComputeShaderCollision();
    },
  });

  observer.subscribe("collisions", {
    id: OBSERVER_ID,
    callback: (collisions) => {
      // Create a new planet for each collision found.
      createPlanets({
        planetsToCreate: (collisions as CollisionPair[]).length,
        currentNumberOfPlanets: getNumberOfPlanets(),
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

/// Setup UI
SetupUI();

/// Create Shader Module from WGSL file
const shaderModule = device.createShaderModule({ code: planetWGSL });
console.assert(shaderModule !== null, "Failed to compile shader code");

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

/// Create the planets
const { create: createPlanets, getPlanetsBuffers } =
  await CreatePlanets(device);
createPlanets({
  currentNumberOfPlanets: getNumberOfPlanets(),
});

//// VERTEX AND FRAGMENT SHADER STUFF ///////
//

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

const passDescriptor: GPURenderPassDescriptor = {
  label: "pass descriptor element",
  colorAttachments: [
    {
      view: context.getCurrentTexture().createView(), // assigned later
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

// Renders on the same frame must use the same render pass, otherwise
// it switches (either one or the other, not both)
let renderPass: GPURenderPassEncoder;
let currentFrame = 1;
function frame() {
  stats.begin();

  // Update Texture View
  const colorAttachmentsArray = Array.from(passDescriptor.colorAttachments);
  colorAttachmentsArray[0]!.view = context.getCurrentTexture().createView();
  passDescriptor.colorAttachments = colorAttachmentsArray;

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
    Observer().notify("renderTail", {
      recalculateTailBuffer: currentFrame % RENDER_TAIL_FREQUENCY === 0,
    });
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
