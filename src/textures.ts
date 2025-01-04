import { webGPUTextureFromImageUrl } from "./utils";

import EarthTexture from "/textures/earth.png";
import MoonTexture from "/textures/moon.jpg";
import PlutoTexture from "/textures/pluto.jpg";
import JupiterTexture from "/textures/jupiter.jpg";
import VenusTexture from "/textures/venus.jpg";

export class PlanetTextures {
  earthTexture: GPUTexture | null = null;
  moonTexture: GPUTexture | null = null;
  venusTexture: GPUTexture | null = null;
  jupiterTexture: GPUTexture | null = null;
  plutoTexture: GPUTexture | null = null;
  length: number = 5;

  constructor(device: GPUDevice) {
    return (async (): Promise<PlanetTextures> => {
      await this._loadTextures(device);
      return this;
    })() as unknown as PlanetTextures;
  }

  async _loadTextures(device: GPUDevice) {
    this.earthTexture = await webGPUTextureFromImageUrl(device, EarthTexture);
    this.moonTexture = await webGPUTextureFromImageUrl(device, MoonTexture);
    this.venusTexture = await webGPUTextureFromImageUrl(device, VenusTexture);
    this.jupiterTexture = await webGPUTextureFromImageUrl(
      device,
      JupiterTexture,
    );
    this.plutoTexture = await webGPUTextureFromImageUrl(device, PlutoTexture);
  }

  getTextureBasedOnIndex(id: number): GPUTexture {
    switch (id) {
      case 0: {
        return this.venusTexture!;
      }
      case 1: {
        return this.moonTexture!;
      }
      case 2: {
        return this.earthTexture!;
      }
      case 3: {
        return this.jupiterTexture!;
      }
      case 4: {
        return this.plutoTexture!;
      }
      default: {
        return this.moonTexture!;
      }
    }
  }

  getNumberOfTextures(): number {
    return this.length;
  }
}
