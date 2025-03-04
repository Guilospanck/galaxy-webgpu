import { vec3 } from "gl-matrix";

export const MAT4X4_BYTE_LENGTH = 4 * 4 * Float32Array.BYTES_PER_ELEMENT;
export const NEAR_FRUSTUM = 0.1;
export const FAR_FRUSTUM = 100000;
export const WORKGROUP_SIZE = 64;
export const DEGREE_TO_RAD = 0.0174532925; // 1 deg = 0.0174532925 rad
export const FULL_CIRCUMFERENCE = 360; // 360 degrees
export const CHECK_COLLISION_FREQUENCY = 1097; // Check for collisions every currentFrame % 1097 === 0
export const RENDER_TAIL_FREQUENCY = 100;
export const ROTATION_SPEED_SENSITIVITY = 1e-3;

export const TRANSLATION_SPEED_SENSITIVITY = 0.1;
export const TRANSLATION_SPEED_SENSITIVITY_MAX = 10.0;
export const TRANSLATION_SPEED_SENSITIVITY_MIN = 0.01;
export const TRANSLATION_SPEED_SENSITIVITY_STEP = 0.001;

export enum TopologyEnum {
  POINT_LIST = "point-list",
  TRIANGLE_LIST = "triangle-list",
  LINE_LIST = "line-list",
  // LINE_STRIP = "line-strip",
  // TRIANGLE_STRIP = "triangle-strip",
}

export const TOPOLOGIES = [
  TopologyEnum.POINT_LIST,
  TopologyEnum.TRIANGLE_LIST,
  TopologyEnum.LINE_LIST,
  // TopologyEnum.LINE_STRIP,
  // TopologyEnum.TRIANGLE_STRIP,
];

export const DEFAULT_TOPOLOGY = TopologyEnum.TRIANGLE_LIST;

export const DEFAULT_PLANETS = 8;
export const PLANETS_STEP = 1;
export const MIN_PLANETS = 1;
export const MAX_PLANETS = 12000; // 12K is not a rookie number in this racket. No need to pump it!

export const DEFAULT_ECCENTRICITY = 0.7;
export const ECCENTRICITY_STEP = 0.01;
export const MIN_ECCENTRICITY = 0.01;
export const MAX_ECCENTRICITY = 0.99;

export const DEFAULT_ELLIPSE_A = 10;
export const ELLIPSE_A_STEP = 1;
export const MIN_ELLIPSE_A = 1;
export const MAX_ELLIPSE_A = 100;

export const DEFAULT_LAT_BANDS = 40;
export const LAT_BANDS_STEP = 1;
export const MIN_LAT_BANDS = 2;
export const MAX_LAT_BANDS = 100;

export const DEFAULT_LONG_BANDS = 40;
export const LONG_BANDS_STEP = 1;
export const MIN_LONG_BANDS = 2;
export const MAX_LONG_BANDS = 100;

/// Pointer events
export const ZOOM_FACTOR_SENSITIVITY = 1.05;
export const PAN_SENSITIVITY = 0.7;
export const ROTATION_SENSITIVITY = 0.01;

export const EMPTY_VECTOR: vec3 = [0, 0, 0];
export const CAMERA_UP: vec3 = [0, 1, 0];

export const COLLISION_CREATED_PLANET_RADIUS = 3;
