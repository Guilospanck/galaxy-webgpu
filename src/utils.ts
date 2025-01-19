import { mat4, vec3, vec4 } from "gl-matrix";
import {
  DEGREE_TO_RAD,
  FAR_FRUSTUM,
  MAT4X4_BYTE_LENGTH,
  NEAR_FRUSTUM,
} from "./constants";
import { PlanetCenterPointRadiusAndIndex, PlanetInfo } from "./types";

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

///
///  Ellipse equation:
//
//   (x-h)^2/a^2 + (y-k)^2/b^2 = 1
//
//   c(h, k)
//
//   when c(0, 0), meaning that the ellipse is centered:
//
//   x^2/a^2 + y^2/b^2 = 1
//
//   Radial distance, depends of the angle:
//
//   R = \frac{1}{\sqrt{ \frac{\cos^2\theta}{a^2} + \frac{\sin^2\theta}{b^2} } }
//
//   cos²x = (cos x)² ≠ cos x²
//
//   Eccentricity:
//
//   e = Math.sqrt(Math.pow(a, 2) - Math.pow(b, 2)) / a
//   => Math.pow(a * e, 2) =  Math.pow(a, 2) - Math.pow(b, 2)
//   => -b2 = (ae)2 - a2
//   => b2 = a2 - (ae)2
//
//
export const calculateXYZEllipseCoordinates = ({
  degreeAngle,
  ellipse_a: a,
  ellipse_eccentricity: eccentricity,
}: {
  degreeAngle: number;
  ellipse_a: number;
  ellipse_eccentricity: number;
}) => {
  const a2 = Math.pow(a, 2);
  const b2 = a2 - Math.pow(a * eccentricity, 2);
  const b = Math.sqrt(b2);

  let theta = degreeAngle * DEGREE_TO_RAD;

  const x = a * Math.cos(theta);
  const y = b * Math.sin(theta);
  const z = 1;

  return { x, y, z };
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
  const modelMatrix = mat4.translate(
    mat4.create(),
    mat4.create(),
    modelTranslation,
  );
  mat4.rotateX(modelMatrix, modelMatrix, modelRotationX);
  mat4.rotateY(modelMatrix, modelMatrix, modelRotationY);
  mat4.rotateZ(modelMatrix, modelMatrix, modelRotationZ);

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

// INFO: @deprecated because we are not calculating the simple combination
// in order to have the right size for the collisionsBuffer (number of possible
// collisions based on the number of planets).
// export const calculateFactorial = (input: number): number => {
//   let result = input;
//   for (let i = input - 1; i >= 1; i--) {
//     result *= i;
//   }
//   return result;
// };
//

const PLANET_INITIAL_CENTER: vec4 = [0, 0, 0, 1];
export const getPlanetsCenterPointAndRadius = ({
  numberOfPlanets,
  planetsBuffers,
  modelMatrixUniformBufferSize,
  allModelMatrices,
}: {
  numberOfPlanets: number;
  planetsBuffers: PlanetInfo[];
  modelMatrixUniformBufferSize: number;
  allModelMatrices: Float32Array;
}): Array<PlanetCenterPointRadiusAndIndex> => {
  const planetsCenterPointAndRadius: Array<PlanetCenterPointRadiusAndIndex> =
    [];

  // Get all current center point (in world space, after model matrix is applied) of each planet, along with its radius
  for (let i = 0; i < numberOfPlanets; i++) {
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
      planetIdx: i,
    });
  }

  return planetsCenterPointAndRadius;
};
