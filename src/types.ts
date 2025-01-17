export type PlanetInfo = {
  vertexBuffer: GPUBuffer; // position and texCoords
  indexBuffer: GPUBuffer;
  indices: number[];
  texture?: GPUTexture;
  radius: number;
};

export type PlanetCenterPointRadiusAndIndex = {
  x: number;
  y: number;
  z: number;
  radius: number;
  planetIdx: number;
};
