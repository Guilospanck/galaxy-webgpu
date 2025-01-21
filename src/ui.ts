import { GUI, GUIController } from "dat.gui";

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
import { Observer } from "./observer";

export const UI_SETTINGS = {
  planets: DEFAULT_PLANETS,
  eccentricity: DEFAULT_ECCENTRICITY,
  ellipseA: DEFAULT_ELLIPSE_A,
  topology: DEFAULT_TOPOLOGY,
  latBands: DEFAULT_LAT_BANDS,
  longBands: DEFAULT_LONG_BANDS,
  enableArmor: false,
  enableTail: false,
  enableCollisions: false,
};

interface UI {
  planetsGUIListener: GUIController<object>;
}

export const SetupUI = (() => {
  let singleton: UI | null = null;

  return () => {
    if (singleton) {
      return singleton;
    }

    const gui = new GUI();

    const planetsGUIListener = gui
      .add(UI_SETTINGS, "planets", MIN_PLANETS, MAX_PLANETS)
      .step(PLANETS_STEP)
      .onChange((numOfPlanets) => {
        Observer().notify("planets", numOfPlanets);
      });
    gui
      .add(UI_SETTINGS, "eccentricity", MIN_ECCENTRICITY, MAX_ECCENTRICITY)
      .step(ECCENTRICITY_STEP)
      .onChange((eccentricity) => {
        Observer().notify("eccentricity", eccentricity);
      });
    gui
      .add(UI_SETTINGS, "ellipseA", MIN_ELLIPSE_A, MAX_ELLIPSE_A)
      .step(ELLIPSE_A_STEP)
      .onChange((ellipseA) => {
        Observer().notify("ellipseA", ellipseA);
      });
    gui.add(UI_SETTINGS, "topology", TOPOLOGIES).onChange((topology) => {
      Observer().notify("topology", topology);
    });
    gui
      .add(UI_SETTINGS, "latBands", MIN_LAT_BANDS, MAX_LAT_BANDS)
      .onChange((latBands) => {
        Observer().notify("latBands", latBands);
      });
    gui
      .add(UI_SETTINGS, "longBands", MIN_LONG_BANDS, MAX_LONG_BANDS)
      .onChange((longBands) => {
        Observer().notify("longBands", longBands);
      });

    gui.add(UI_SETTINGS, "enableTail").onChange((enableTail) => {
      Observer().notify("enableTail", enableTail);
    });
    gui.add(UI_SETTINGS, "enableArmor").onChange((enableArmor) => {
      Observer().notify("enableArmor", enableArmor);
    });
    gui.add(UI_SETTINGS, "enableCollisions").onChange((enableCollisions) => {
      Observer().notify("enableCollisions", enableCollisions);
    });

    singleton = {
      planetsGUIListener,
    };

    return singleton;
  };
})();
