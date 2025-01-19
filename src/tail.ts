import { vec3 } from "gl-matrix";
import { PlanetCenterPointRadiusAndIndex, PlanetInfo } from "./types";
import { getPlanetsCenterPointAndRadius } from "./utils";

export const Tail = ({
  format,
  device,
  shaderModule,
}: {
  format: GPUTextureFormat;
  device: GPUDevice;
  shaderModule: GPUShaderModule;
}) => {
  let coordinatesPerPlanet = 0;
  let tailCenterPositionsComplete: PlanetCenterPointRadiusAndIndex[] = [];
  let tailVertexBuffer: GPUBuffer;
  let tailCenterPositions: vec3[] = [];

  const resetCoordinatesPerPlanet = () => (coordinatesPerPlanet = 0);
  const resetTailCenterPositionsComplete = () =>
    (tailCenterPositionsComplete = []);

  // Bind group for the tail rendering
  const tailBindGroupLayout = device.createBindGroupLayout({
    label: "tail bind group layout",
    entries: [
      {
        binding: 0, // View-Projection matrix buffer
        visibility: GPUShaderStage.VERTEX,
        buffer: {
          type: "uniform",
        },
      },
    ],
  });

  // Tail pipeline
  const tailPipeline = device.createRenderPipeline({
    label: "tail render pipeline",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [tailBindGroupLayout],
    }),
    vertex: {
      module: shaderModule,
      entryPoint: "planet_tail_vertex",
      buffers: [
        {
          arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT, // 3 center position (x, y, z)
          attributes: [
            {
              shaderLocation: 0,
              format: "float32x3",
              offset: 0,
            },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "planet_tail_fragment",
      targets: [{ format }],
    },
    primitive: { topology: "point-list" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  const updateVariableTailBuffers = ({
    numberOfPlanets,
    planetsBuffers,
    modelMatrixUniformBufferSize,
    allModelMatrices,
  }: {
    numberOfPlanets: number;
    planetsBuffers: PlanetInfo[];
    modelMatrixUniformBufferSize: number;
    allModelMatrices: Float32Array;
  }) => {
    // Get center points
    const planetsCenter = getPlanetsCenterPointAndRadius({
      numberOfPlanets,
      planetsBuffers,
      modelMatrixUniformBufferSize,
      allModelMatrices,
    });
    tailCenterPositionsComplete.push(...planetsCenter);

    // Order the tailCenterPosition vector to have all
    // planets coordinates ordered
    tailCenterPositions = [];
    for (let i = 0; i < numberOfPlanets; i++) {
      const coordinatesOfPlanetCenterPoint = tailCenterPositionsComplete
        .filter((item) => item.planetIdx === i)
        .map((item) => vec3.fromValues(item.x, item.y, item.z));
      tailCenterPositions.push(...coordinatesOfPlanetCenterPoint);
    }

    // Create/Update Position (VERTEX BUFFER)
    tailVertexBuffer = device.createBuffer({
      label: "tail vertices buffer",
      size: tailCenterPositions.length * 3 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(tailVertexBuffer.getMappedRange()).set(
      tailCenterPositions.map((a) => [...a]).flat() as number[],
    );
    tailVertexBuffer.unmap();

    // update how many points a planet has
    coordinatesPerPlanet++;
  };

  const renderTail = ({
    numberOfPlanets,
    planetsBuffers,
    modelMatrixUniformBufferSize,
    allModelMatrices,
    viewProjectionMatrixUniformBuffer,
    renderPass,
    recalculateTailBuffer,
  }: {
    numberOfPlanets: number;
    planetsBuffers: PlanetInfo[];
    modelMatrixUniformBufferSize: number;
    allModelMatrices: Float32Array;
    viewProjectionMatrixUniformBuffer: GPUBuffer;
    renderPass: GPURenderPassEncoder;
    recalculateTailBuffer: boolean;
  }) => {
    // Only calculate the tail center positions when:
    // the current frame is a multiple of the current RENDER_TAIL_FREQUENCY;
    // - OR the array of tailCenterPositions is empty;

    if (recalculateTailBuffer || tailCenterPositions.length === 0) {
      updateVariableTailBuffers({
        numberOfPlanets,
        planetsBuffers,
        modelMatrixUniformBufferSize,
        allModelMatrices,
      });
    }

    // this depends on the view projection (camera) matrix,
    // so it needs to be checked almost all the time because
    // we don't know (we could, but not now) either the camera
    // has changed or not (translated, rotated)
    const tailBindGroup = device.createBindGroup({
      label: "tail bind group element",
      layout: tailPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: viewProjectionMatrixUniformBuffer,
          },
        },
      ],
    });

    renderPass.setPipeline(tailPipeline);
    renderPass.setVertexBuffer(0, tailVertexBuffer);
    renderPass.setBindGroup(0, tailBindGroup);
    renderPass.draw(
      tailCenterPositions.slice(0, coordinatesPerPlanet * numberOfPlanets)
        .length,
    );
  };

  return {
    renderTail,
    resetCoordinatesPerPlanet,
    resetTailCenterPositionsComplete,
    updateVariableTailBuffers,
  };
};
