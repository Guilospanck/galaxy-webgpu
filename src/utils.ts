import { mat4, vec3 } from "gl-matrix";
import { FAR_FRUSTUM, NEAR_FRUSTUM } from "./constants";

/// Yoinked from https://toji.dev/webgpu-best-practices/img-textures
const webGPUTextureFromImageBitmapOrCanvas = (
  gpuDevice: GPUDevice,
  source: ImageBitmap,
) => {
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
};

/// Yoinked from https://toji.dev/webgpu-best-practices/img-textures
export const webGPUTextureFromImageUrl = async (
  gpuDevice: GPUDevice,
  url: string,
) => {
  const response = await fetch(url);
  const blob = await response.blob();
  const imgBitmap = await createImageBitmap(blob);

  return webGPUTextureFromImageBitmapOrCanvas(gpuDevice, imgBitmap);
};

/// Sphere generation
export const createSphere = ({
  radius,
  latBands,
  lonBands,
}: {
  radius: number;
  latBands: number;
  lonBands: number;
}) => {
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
};

export type PointerEventsCallbackData = {
  rotationAngleX: number;
  rotationAngleY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
};

type PointerEventsInput = {
  canvas: HTMLCanvasElement;
  rotationAngleX: number;
  rotationAngleY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  callback: (data: PointerEventsCallbackData) => void;
};

/// Adds pointer events to the canvas for panning, zooming and rotating (when holding shift).
//
export const setupPointerEvents = (input: PointerEventsInput): void => {
  const { canvas, callback } = input;
  let { rotationAngleX, rotationAngleY, scale, offsetX, offsetY } = input;

  let isDragging = false;
  let lastPointerX: number | null = null;
  let lastPointerY: number | null = null;

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
    callback({ rotationAngleX, rotationAngleY, scale, offsetX, offsetY });
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

    callback({ rotationAngleX, rotationAngleY, scale, offsetX, offsetY });
  });
};

type ModelViewProjectionInputParams = {
  modelRotationX?: number;
  modelRotationY?: number;
  cameraEye?: vec3;
  cameraLookupCenter?: vec3;
  cameraUp?: vec3;
  perspectiveAspectRatio: number;
};

/// Calculates and returns the model-view-projection matrix
/// based on input params.
///
/// @param{modelRotationX}: angle in radians of how much to rotate the model around the Y-axis;
/// @param{modelRotationY}: angle in radians of how much to rotate the model around the X-axis;
/// @param{cameraEye}: the position of the camera;
/// @param{cameraLookupCenter}: the point at which point the camera is looking at;
/// @param{cameraUp}: what is the up for the camera. It needs to be orthogonal to the viewing direction;
/// @param{perspectiveAspectRatio}: the aspect ratio at which the perspective is being rendered for the project matrix.
///
/// Returns matrix in Float32Array format.
export const getModelViewProjectionMatrix = (
  input: ModelViewProjectionInputParams,
): Float32Array => {
  const {
    modelRotationY = 0,
    modelRotationX = 0,
    cameraEye = [0, 0, 4],
    cameraLookupCenter = [0, 0, 0],
    cameraUp = [0, 1, 0],
    perspectiveAspectRatio,
  } = input;

  // Model
  const modelMatrix = mat4.rotateY(
    mat4.create(),
    mat4.create(),
    modelRotationX,
  );
  mat4.rotateX(modelMatrix, modelMatrix, modelRotationY);

  // View
  const viewMatrix = mat4.lookAt(
    mat4.create(),
    cameraEye,
    cameraLookupCenter,
    cameraUp,
  );

  // Projection
  const projectionMatrix = mat4.perspective(
    mat4.create(),
    Math.PI / 4,
    perspectiveAspectRatio,
    NEAR_FRUSTUM,
    FAR_FRUSTUM,
  );

  const mvpMatrix = mat4.multiply(
    mat4.create(),
    projectionMatrix,
    mat4.multiply(mat4.create(), viewMatrix, modelMatrix),
  );

  return new Float32Array(mvpMatrix);
};