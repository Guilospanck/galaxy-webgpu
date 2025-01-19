import { webGPUTextureFromImageUrl } from "./utils";

import EarthTexture from "/textures/earth.png";
import MoonTexture from "/textures/moon.jpg";
import PlutoTexture from "/textures/pluto.jpg";
import JupiterTexture from "/textures/jupiter.jpg";
import VenusTexture from "/textures/venus.jpg";

export const PlanetTextures = async (device: GPUDevice) => {
  let earthTexture: GPUTexture | null = null;
  let moonTexture: GPUTexture | null = null;
  let venusTexture: GPUTexture | null = null;
  let jupiterTexture: GPUTexture | null = null;
  let plutoTexture: GPUTexture | null = null;
  const LENGTH: number = 5;

  await _loadTextures();

  async function _loadTextures() {
    earthTexture = await webGPUTextureFromImageUrl(device, EarthTexture);
    moonTexture = await webGPUTextureFromImageUrl(device, MoonTexture);
    venusTexture = await webGPUTextureFromImageUrl(device, VenusTexture);
    jupiterTexture = await webGPUTextureFromImageUrl(device, JupiterTexture);
    plutoTexture = await webGPUTextureFromImageUrl(device, PlutoTexture);
  }

  function getTextureBasedOnIndex(id: number): GPUTexture {
    switch (id) {
      case 0: {
        return venusTexture!;
      }
      case 1: {
        return moonTexture!;
      }
      case 2: {
        return earthTexture!;
      }
      case 3: {
        return jupiterTexture!;
      }
      case 4: {
        return plutoTexture!;
      }
      default: {
        return moonTexture!;
      }
    }
  }

  return {
    getTextureBasedOnIndex,
    LENGTH,
  };
};
