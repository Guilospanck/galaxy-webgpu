export type WebGPUAndCanvas = {
  canvas: HTMLCanvasElement;
  context: GPUCanvasContext;
  device: GPUDevice;
  format: GPUTextureFormat;
};

export const initWebGPUAndCanvas = async (): Promise<WebGPUAndCanvas> => {
  if (!navigator?.gpu) {
    throw Error("WebGPU not supported.");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw Error("Couldn't request WebGPU adapter.");
  }

  const device = await adapter.requestDevice();
  device.lost.then((info) => {
    console.error("GPU device lost:", info.message);
  });

  const canvas = document.getElementById("galaxy") as HTMLCanvasElement | null;
  if (!canvas) {
    throw Error("Couldn't find canvas with id 'galaxy'");
  }
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const context = canvas.getContext("webgpu") as GPUCanvasContext;

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
  });

  return {
    canvas,
    context,
    device,
    format,
  };
};
