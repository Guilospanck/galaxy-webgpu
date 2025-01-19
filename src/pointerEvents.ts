import {
  PAN_SENSITIVITY,
  ROTATION_SENSITIVITY,
  ZOOM_FACTOR_SENSITIVITY,
} from "./constants";
import { Observer } from "./observer";

export type PointerEventsTransformations = {
  rotationAngleX: number;
  rotationAngleY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
};

export const DEFAULT_POINTER_EVENTS: PointerEventsTransformations = {
  rotationAngleX: 0,
  rotationAngleY: 0,
  scale: 5,
  offsetX: 0,
  offsetY: 0,
};

interface PointerEvents {}

/// Adds pointer events to the canvas for panning, zooming and rotating (when holding shift).
//
export const SetupPointerEvents = (() => {
  let singleton: PointerEvents | null = null;

  return (canvas: HTMLCanvasElement) => {
    if (singleton) {
      return singleton;
    }

    // Default initial values
    let pointerEvents = DEFAULT_POINTER_EVENTS;

    let isDragging = false;
    let lastPointerX: number | null = null;
    let lastPointerY: number | null = null;

    const observer = Observer();

    canvas.addEventListener("pointerdown", (event) => {
      isDragging = true;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
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

    canvas.addEventListener("pointermove", (event) => {
      if (!isDragging || lastPointerX === null || lastPointerY === null) return;

      const deltaX = event.clientX - lastPointerX;
      const deltaY = event.clientY - lastPointerY;

      if (event.shiftKey) {
        // Rotate if Shift key is pressed
        pointerEvents.rotationAngleX += deltaX * ROTATION_SENSITIVITY; // Adjust sensitivity
        pointerEvents.rotationAngleY += deltaY * ROTATION_SENSITIVITY; // Adjust sensitivity
      } else {
        // Pan otherwise
        pointerEvents.offsetX += deltaX * PAN_SENSITIVITY;
        pointerEvents.offsetY += deltaY * PAN_SENSITIVITY;
      }

      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      observer.notify("pointerEvents", pointerEvents);
    });

    // Wheel event for zooming
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();

      if (event.deltaY < 0) {
        pointerEvents.scale *= ZOOM_FACTOR_SENSITIVITY; // Zoom in
      } else {
        pointerEvents.scale /= ZOOM_FACTOR_SENSITIVITY; // Zoom out
      }

      observer.notify("pointerEvents", pointerEvents);
    });

    singleton = {};
    return singleton;
  };
})();
