import { mat4, vec3 } from "gl-matrix";
import { FAR_FRUSTUM, NEAR_FRUSTUM } from "./constants";

/// Yoinked from https://toji.dev/webgpu-best-practices/img-textures
const webGPUTextureFromImageBitmapOrCanvas = (
  gpuDevice: GPUDevice,
  source: ImageBitmap,
  url: string,
) => {
  const textureDescriptor = {
    // Unlike in WebGL, the size of our texture must be set at texture creation time.
    // This means we have to wait until the image is loaded to create the texture, since we won't
    // know the size until then.
    label: `texture element ${url}`,
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

  return webGPUTextureFromImageBitmapOrCanvas(gpuDevice, imgBitmap, url);
};

/// Sphere generation
///
/// It uses [spherical coordinates](https://mathworld.wolfram.com/SphericalCoordinates.html) to calculate the values.
///
/// @param{radius}: the radius (r) of the sphere;
/// @param{latBands}: the number of latitude bands (horizontal stripes) that the sphere will have. The greater this value,
/// the smoother the sphere, but also demands more computationally.
/// @param{longBands}: the number of longitude bands (vertical slices) that the sphere will have. The greater this value,
/// the smoother the sphere, but also demands more computationally.
//
export const createSphereMesh = ({
  radius,
  latBands,
  longBands,
}: {
  radius: number;
  latBands: number;
  longBands: number;
}) => {
  // TODO: once we are using normals, we can also add it to the same buffer of pos | texCoords | normals
  const positionAndTexCoords = [];
  const indices = [];
  const normals = [];

  for (let lat = 0; lat <= latBands; ++lat) {
    const theta = (lat * Math.PI) / latBands; // Latitude angle
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon <= longBands; ++lon) {
      const phi = (lon * 2 * Math.PI) / longBands; // Longitude angle
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      const x = cosPhi * sinTheta;
      const y = cosTheta;
      const z = sinPhi * sinTheta;

      const u = lon / longBands;
      const v = lat / latBands;

      positionAndTexCoords.push(radius * x, radius * y, radius * z, u, v);
      normals.push(x, y, z);
    }
  }

  /*
   * Vertices:
      second     second + 1
        *-----------*
        |         / |
        |       /   |
        |     /     |
        *-----------*
      first       first + 1
   *
   * */
  const moveVerticallyToNextLatitudeBand = longBands + 1;
  const moveHorizontallyToNextLongitudeBand = (curr: number) => curr + 1;
  for (let lat = 0; lat < latBands; ++lat) {
    for (let lon = 0; lon < longBands; ++lon) {
      // Index of the bottom-left vertex of the quad
      const first = lat * moveVerticallyToNextLatitudeBand + lon;
      // Index of the top-left vertex of the quad
      const second = first + moveVerticallyToNextLatitudeBand;

      // First triangle: bottom-left, top-left, bottom-right
      indices.push(first, second, moveHorizontallyToNextLongitudeBand(first));
      // Second triangle: top-left, top-right, bottom-right
      indices.push(
        second,
        moveHorizontallyToNextLongitudeBand(second),
        moveHorizontallyToNextLongitudeBand(first),
      );
    }
  }

  return { positionAndTexCoords, indices, normals };
};

export type PointerEventsCallbackData = {
  rotationAngleX: number;
  rotationAngleY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type PointerEventsTransformations = {
  rotationAngleX: number;
  rotationAngleY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
};

type PointerEventsInput = {
  canvas: HTMLCanvasElement;
  pointerEvents: PointerEventsTransformations;
  callback: (data: PointerEventsCallbackData) => void;
};

/// Adds pointer events to the canvas for panning, zooming and rotating (when holding shift).
//
export const setupPointerEvents = (input: PointerEventsInput): void => {
  const { canvas, callback } = input;
  let { rotationAngleX, rotationAngleY, scale, offsetX, offsetY } =
    input.pointerEvents;

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
      offsetX += deltaX * 0.1;
      offsetY += deltaY * 0.1;
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

    const zoomFactor = 1.01; // Adjust sensitivity
    if (event.deltaY < 0) {
      scale *= zoomFactor; // Zoom in
    } else {
      scale /= zoomFactor; // Zoom out
    }

    callback({ rotationAngleX, rotationAngleY, scale, offsetX, offsetY });
  });
};

type ModelInputParams = {
  modelRotationX?: number;
  modelRotationY?: number;
  modelRotationZ?: number;
  modelTranslation?: vec3;
};

type ViewProjectionInputParams = {
  cameraRotationX?: number;
  cameraRotationY?: number;
  cameraRotationZ?: number;
  cameraEye?: vec3;
  cameraLookupCenter?: vec3;
  cameraUp?: vec3;
  perspectiveAspectRatio: number;
};

type ModelViewProjectionInputParams = ModelInputParams &
  ViewProjectionInputParams;

export const getViewProjectionMatrix = (
  input: ViewProjectionInputParams,
): Float32Array => {
  const {
    cameraRotationX = 0,
    cameraRotationY = 0,
    cameraRotationZ = 0,
    cameraEye = [0, 0, 4],
    cameraLookupCenter = [0, 0, 0],
    cameraUp = [0, 1, 0],
    perspectiveAspectRatio,
  } = input;

  // View
  const viewMatrix = mat4.lookAt(
    mat4.create(),
    cameraEye,
    cameraLookupCenter,
    cameraUp,
  );
  mat4.rotateX(viewMatrix, viewMatrix, cameraRotationX);
  mat4.rotateY(viewMatrix, viewMatrix, cameraRotationY);
  mat4.rotateZ(viewMatrix, viewMatrix, cameraRotationZ);

  // Projection
  const projectionMatrix = mat4.perspective(
    mat4.create(),
    Math.PI / 4,
    perspectiveAspectRatio,
    NEAR_FRUSTUM,
    FAR_FRUSTUM,
  );

  const viewProjectionMatrix = mat4.multiply(
    mat4.create(),
    projectionMatrix,
    viewMatrix,
  );

  return new Float32Array(viewProjectionMatrix);
};

export const getModelMatrix = (input: ModelInputParams): Float32Array => {
  const {
    modelRotationX = 0,
    modelRotationY = 0,
    modelRotationZ = 0,
    modelTranslation = [0, 0, 0],
  } = input;

  // Model
  const modelMatrix = mat4.rotateX(
    mat4.create(),
    mat4.create(),
    modelRotationX,
  );
  mat4.rotateY(modelMatrix, modelMatrix, modelRotationY);
  mat4.rotateZ(modelMatrix, modelMatrix, modelRotationZ);
  mat4.translate(modelMatrix, modelMatrix, modelTranslation);

  return new Float32Array(modelMatrix);
};

/// Calculates and returns the model-view-projection matrix
/// based on input params.
///
/// @param{modelRotationX}: angle in radians of how much to rotate the model around the X-axis;
/// @param{modelRotationY}: angle in radians of how much to rotate the model around the Y-axis;
/// @param{modelRotationZ}: angle in radians of how much to rotate the model around the Z-axis;
/// @param{cameraRotationX}: angle in radians of how much to rotate the camera around the X-axis;
/// @param{cameraRotationY}: angle in radians of how much to rotate the camera around the Y-axis;
/// @param{cameraRotationZ}: angle in radians of how much to rotate the camera around the Z-axis;
/// @param{modelTranslation}: vec3 containing the model translations in x, y and z;
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
    modelRotationX = 0,
    modelRotationY = 0,
    modelRotationZ = 0,
    cameraRotationX = 0,
    cameraRotationY = 0,
    cameraRotationZ = 0,
    modelTranslation = [0, 0, 0],
    cameraEye = [0, 0, 4],
    cameraLookupCenter = [0, 0, 0],
    cameraUp = [0, 1, 0],
    perspectiveAspectRatio,
  } = input;

  // Model
  const modelMatrix = getModelMatrix({
    modelRotationX,
    modelRotationY,
    modelRotationZ,
    modelTranslation,
  });

  // View-Projection matrix
  const viewProjectionMatrix = getViewProjectionMatrix({
    cameraRotationX,
    cameraRotationY,
    cameraRotationZ,
    cameraEye,
    cameraLookupCenter,
    cameraUp,
    perspectiveAspectRatio,
  });

  const mvpMatrix = mat4.multiply(
    mat4.create(),
    viewProjectionMatrix,
    modelMatrix,
  );

  return new Float32Array(mvpMatrix);
};

export const roundUp = (size: number, alignment: number) =>
  Math.ceil(size / alignment) * alignment;

export const hasCameraChangedPositions = (
  currCameraInfo: PointerEventsTransformations,
  newCameraInfo: PointerEventsTransformations,
): boolean => {
  if (currCameraInfo.rotationAngleX !== newCameraInfo.rotationAngleX) {
    return true;
  }
  if (currCameraInfo.rotationAngleY !== newCameraInfo.rotationAngleY) {
    return true;
  }
  if (currCameraInfo.offsetX !== newCameraInfo.offsetX) {
    return true;
  }
  if (currCameraInfo.offsetX !== newCameraInfo.offsetX) {
    return true;
  }
  if (currCameraInfo.scale !== newCameraInfo.scale) {
    return true;
  }

  return false;
};
