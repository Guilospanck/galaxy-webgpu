import { GUI } from "dat.gui";

import {
  DEFAULT_ECCENTRICITY,
  DEFAULT_ELLIPSE_A,
  DEFAULT_LAT_BANDS,
  DEFAULT_LONG_BANDS,
  DEFAULT_PLANETS,
  DEFAULT_TOPOLOGY,
  ECCENTRICITY_STEP,
  ELLIPSE_A_STEP,
  MAX_ECCENTRICITY,
  MAX_ELLIPSE_A,
  MAX_LAT_BANDS,
  MAX_LONG_BANDS,
  MAX_PLANETS,
  MIN_ECCENTRICITY,
  MIN_ELLIPSE_A,
  MIN_LAT_BANDS,
  MIN_LONG_BANDS,
  MIN_PLANETS,
  PLANETS_STEP,
  TOPOLOGIES,
} from "./constants";

export const uiSettings = {
  planets: DEFAULT_PLANETS,
  eccentricity: DEFAULT_ECCENTRICITY,
  ellipse_a: DEFAULT_ELLIPSE_A,
  armor: false,
  tail: false,
  checkCollisions: false,
  topology: DEFAULT_TOPOLOGY,
  latBands: DEFAULT_LAT_BANDS,
  longBands: DEFAULT_LONG_BANDS,
};

export type SettingsType =
  | "planets"
  | "eccentricity"
  | "ellipse_a"
  | "armor"
  | "tail"
  | "checkCollisions"
  | "topology"
  | "latBands"
  | "longBands";

export const setupUI = ({
  callback,
}: {
  callback: (type: SettingsType, value?: unknown) => void;
}) => {
  const gui = new GUI();
  const planetsGUIListener = gui
    .add(uiSettings, "planets", MIN_PLANETS, MAX_PLANETS)
    .step(PLANETS_STEP)
    .onChange((numOfPlanets) => callback("planets", numOfPlanets))
    .listen();
  gui
    .add(uiSettings, "eccentricity", MIN_ECCENTRICITY, MAX_ECCENTRICITY)
    .step(ECCENTRICITY_STEP)
    .onChange(() => callback("eccentricity"));
  gui
    .add(uiSettings, "ellipse_a", MIN_ELLIPSE_A, MAX_ELLIPSE_A)
    .step(ELLIPSE_A_STEP)
    .onChange(() => callback("ellipse_a"));
  gui.add(uiSettings, "armor").onChange(() => callback("armor"));
  gui
    .add(uiSettings, "tail")
    .onChange((tail: boolean) => callback("tail", tail));
  gui
    .add(uiSettings, "checkCollisions")
    .onChange((check: boolean) => callback("checkCollisions", check));
  gui
    .add(uiSettings, "topology", TOPOLOGIES)
    .onChange(() => callback("topology"));
  gui
    .add(uiSettings, "latBands", MIN_LAT_BANDS, MAX_LAT_BANDS)
    .onChange(() => callback("latBands"));
  gui
    .add(uiSettings, "longBands", MIN_LONG_BANDS, MAX_LONG_BANDS)
    .onChange(() => callback("longBands"));

  return {
    planetsGUIListener,
  };
};
