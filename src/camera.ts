import { vec3 } from "gl-matrix";
import { CAMERA_UP, MAT4X4_BYTE_LENGTH } from "./constants";
import { Observer } from "./observer";
import {
  DEFAULT_POINTER_EVENTS,
  PointerEventsTransformations,
  SetupPointerEvents,
} from "./pointerEvents";
import { getViewProjectionMatrix } from "./utils";

export const SetupCamera = ({
  device,
  canvas,
}: {
  device: GPUDevice;
  canvas: HTMLCanvasElement;
}) => {
  let viewProjectionMatrixUniformBuffer: GPUBuffer;

  const perspectiveAspectRatio = canvas.width / canvas.height;

  /// Setup pointer events
  SetupPointerEvents(canvas);

  /// Setup observers
  Observer().subscribe("pointerEvents", {
    id: "camera.ts",
    callback: (pointerEvents) => {
      // Only recalculate View-Projection matrix if the camera position has changed.
      calculateAndSetViewProjectionMatrix(
        pointerEvents as PointerEventsTransformations,
      );
    },
  });

  function calculateAndSetViewProjectionMatrix(
    pointerEvents?: PointerEventsTransformations,
  ) {
    const { rotationAngleX, rotationAngleY, scale, offsetX, offsetY } =
      pointerEvents ?? DEFAULT_POINTER_EVENTS;

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
  }
  calculateAndSetViewProjectionMatrix();

  function getViewProjectionMatrixUniformBuffer(): GPUBuffer {
    return viewProjectionMatrixUniformBuffer;
  }

  return { getViewProjectionMatrixUniformBuffer };
};
