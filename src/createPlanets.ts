import { Observer } from "./observer";
import { PlanetTextures } from "./textures";
import { PlanetInfo } from "./types";
import { SetupUI, UI_SETTINGS } from "./ui";
import { createSphereMesh } from "./utils";

export const CreatePlanets = async (device: GPUDevice) => {
  /// INFO: One point about this: it is saving the planets' state in memory (planetsBuffer array)
  /// Therefore in the case that we select to render less planets than we currently have,
  /// it will still keep those states in memory.
  /// This is a trade-off between saving this states in memory or re-creating them.
  ///
  let planetsBuffers: PlanetInfo[] = [];

  const textures = await PlanetTextures(device);

  function createPlanetAndItsBuffers({
    radius = 1,
  }: {
    radius?: number;
  }): PlanetInfo {
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
  }

  function create({
    planetsToCreate,
    currentNumberOfPlanets,
    radius,
    addNew,
    updateLatOrLongBands,
  }: {
    planetsToCreate?: number;
    currentNumberOfPlanets: number;
    radius?: number;
    addNew?: boolean;
    updateLatOrLongBands?: boolean;
  }) {
    if (planetsToCreate === undefined) {
      planetsToCreate = currentNumberOfPlanets;
    }

    // INFO: without this the lat and long bands only will be updated
    // for the next planets (those that are not already in the planetsBuffers array)
    if (updateLatOrLongBands) {
      planetsBuffers = [];
    }

    if (addNew) {
      Observer().notify("planets", currentNumberOfPlanets + planetsToCreate);
      UI_SETTINGS.planets = currentNumberOfPlanets;
      SetupUI().planetsGUIListener.setValue(
        currentNumberOfPlanets + planetsToCreate,
      );
    }

    for (let i = 0; i < planetsToCreate; i++) {
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
      const texture = textures.getTextureBasedOnIndex(i % textures.LENGTH);
      console.assert(texture !== null, `Failed to load texture ${i}`);

      planetsBuffers.push({
        vertexBuffer,
        indexBuffer,
        indices,
        radius,
        texture,
      });
    }
  }

  function getPlanetsBuffers(): PlanetInfo[] {
    return planetsBuffers;
  }

  return {
    create,
    getPlanetsBuffers,
  };
};
