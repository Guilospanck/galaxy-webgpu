import { mat4, vec3 } from "gl-matrix";
import {
  EMPTY_VECTOR,
  FULL_CIRCUMFERENCE,
  MAT4X4_BYTE_LENGTH,
  ROTATION_SPEED_SENSITIVITY,
  TopologyEnum,
  TRANSLATION_SPEED_SENSITIVITY,
} from "./constants";
import {
  calculateXYZEllipseCoordinates,
  getModelMatrix,
  roundUp,
} from "./utils";
import { PlanetInfo } from "./types";
import { Observer } from "./observer";

export const Render = ({
  format,
  device,
  shaderModule,
  numberOfPlanets,
}: {
  format: GPUTextureFormat;
  device: GPUDevice;
  shaderModule: GPUShaderModule;
  numberOfPlanets: number;
}) => {
  let planetsCount = numberOfPlanets;

  const sampler = device.createSampler({
    label: "sampler element",
    magFilter: "linear",
    minFilter: "linear",
  });

  // Model Matrix Uniform Buffer
  let modelMatrixUniformBufferSize = MAT4X4_BYTE_LENGTH; // for each planet, we have only a MVP matrix (mat4)
  modelMatrixUniformBufferSize = roundUp(
    modelMatrixUniformBufferSize,
    device.limits.minUniformBufferOffsetAlignment,
  ); // uniform buffer needs to be aligned correctly (it works without it if you don't use dynamic offsets)

  // Fill in all uniform MVP matrices beforehand so you don't have to
  // `device.queue.writeBuffer` (or direct mapping) for each one of the planets.
  let allModelMatrices = new Float32Array(
    (modelMatrixUniformBufferSize * planetsCount) /
      Float32Array.BYTES_PER_ELEMENT,
  );
  const lastAngleForPlanet: Record<number, number> = {};

  const getNumberOfPlanets = () => planetsCount;
  const getAllModelMatrices = () => allModelMatrices;
  const getModelMatrixUniformBufferSize = () => modelMatrixUniformBufferSize;

  /// Set observers
  Observer().subscribe("planets", {
    id: "render.ts",
    callback: (planets) => {
      planetsCount = planets as number;
    },
  });

  // Custom bind group that sets model matrix uniform buffer with a dynamic offset
  const bindGroupLayout = device.createBindGroupLayout({
    label: "custom bind group layout",
    entries: [
      {
        binding: 0, // View-Projection matrix buffer
        visibility: GPUShaderStage.VERTEX,
        buffer: {
          type: "uniform",
        },
      },
      {
        binding: 1, // Model matrix buffer
        visibility: GPUShaderStage.VERTEX,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true, // Enable dynamic offsets
        },
      },
      {
        binding: 2, // Sampler
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {},
      },
      {
        binding: 3, // Texture
        visibility: GPUShaderStage.FRAGMENT,
        texture: {},
      },
    ],
  });

  // Armor pipeline
  const armorPipeline = device.createRenderPipeline({
    label: "armor render pipeline",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    }),
    vertex: {
      module: shaderModule,
      entryPoint: "main",
      buffers: [
        {
          arrayStride: 5 * Float32Array.BYTES_PER_ELEMENT, // 3 position + 2 texCoord
          attributes: [
            // position
            {
              shaderLocation: 0,
              format: "float32x3",
              offset: 0,
            },
            // texCoord
            {
              shaderLocation: 1,
              format: "float32x2",
              offset: 3 * Float32Array.BYTES_PER_ELEMENT,
            },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "armor_fragment",
      targets: [{ format }],
    },
    primitive: { topology: "point-list" },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });

  const setModelMatrixUniformBuffer = ({
    ellipse_a,
    eccentricity,
  }: {
    ellipse_a: number;
    eccentricity: number;
  }): GPUBuffer => {
    const rotation = new Date().getTime() * ROTATION_SPEED_SENSITIVITY;

    allModelMatrices = new Float32Array(
      (modelMatrixUniformBufferSize * planetsCount) /
        Float32Array.BYTES_PER_ELEMENT,
    );

    let previousTranslation: vec3 = [0, 0, 0];
    for (let i = 0; i < planetsCount; i++) {
      const angle = ((lastAngleForPlanet[i] ?? 0) + 1) % FULL_CIRCUMFERENCE;
      lastAngleForPlanet[i] = angle;

      const { x, y, z } = calculateXYZEllipseCoordinates({
        degreeAngle: angle,
        ellipse_a: ellipse_a,
        ellipse_eccentricity: eccentricity,
      });

      previousTranslation = vec3.add(EMPTY_VECTOR, previousTranslation, [
        x,
        y,
        z,
      ]);

      const translation =
        new Date().getTime() * TRANSLATION_SPEED_SENSITIVITY + i;

      // Matrix responsible for the planet movement of translation
      const translationMatrix = mat4.rotateZ(
        mat4.create(),
        mat4.create(),
        translation,
      );
      let modelMatrix = getModelMatrix({
        modelTranslation: previousTranslation,
        modelRotationZ: rotation,
      });

      modelMatrix = new Float32Array(
        mat4.multiply(mat4.create(), translationMatrix, modelMatrix),
      );

      allModelMatrices.set(
        modelMatrix,
        i * (modelMatrixUniformBufferSize / Float32Array.BYTES_PER_ELEMENT),
      );
    }

    // Add those matrices to the uniform buffer
    const modelMatrixUniformBuffer = device.createBuffer({
      label: "model matrix uniform coordinates buffer",
      size: modelMatrixUniformBufferSize * planetsCount,
      usage: GPUBufferUsage.UNIFORM,
      mappedAtCreation: true,
    });
    new Float32Array(modelMatrixUniformBuffer.getMappedRange()).set(
      allModelMatrices,
    );
    modelMatrixUniformBuffer.unmap();

    return modelMatrixUniformBuffer;
  };

  const baseRenderPipeline: GPURenderPipelineDescriptor = {
    label: "render pipeline",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    }),
    vertex: {
      module: shaderModule,
      entryPoint: "main",
      buffers: [
        {
          arrayStride: 5 * Float32Array.BYTES_PER_ELEMENT, // 3 position + 2 texCoord
          attributes: [
            // position
            {
              shaderLocation: 0,
              format: "float32x3",
              offset: 0,
            },
            // texCoord
            {
              shaderLocation: 1,
              format: "float32x2",
              offset: 3 * Float32Array.BYTES_PER_ELEMENT,
            },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "main_fragment",
      targets: [{ format }],
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  };

  // Pipelines based on topology
  const triangleListRenderPipeline = device.createRenderPipeline({
    ...baseRenderPipeline,
    primitive: { topology: TopologyEnum.TRIANGLE_LIST }, // Change this to `point-list` to have a "see-through"
  });
  const pointListRenderPipeline = device.createRenderPipeline({
    ...baseRenderPipeline,
    primitive: { topology: TopologyEnum.POINT_LIST }, // Change this to `point-list` to have a "see-through"
  });
  const lineListRenderPipeline = device.createRenderPipeline({
    ...baseRenderPipeline,
    primitive: { topology: TopologyEnum.LINE_LIST }, // Change this to `point-list` to have a "see-through"
  });

  const getPipelineBasedOnCurrentTopology = (
    topology: TopologyEnum,
  ): GPURenderPipeline => {
    switch (topology) {
      case TopologyEnum.LINE_LIST: {
        return lineListRenderPipeline;
      }
      case TopologyEnum.TRIANGLE_LIST: {
        return triangleListRenderPipeline;
      }
      case TopologyEnum.POINT_LIST: {
        return pointListRenderPipeline;
      }
    }
  };

  const renderPlanets = async ({
    renderPass,
    enableArmor,
    ellipse_a,
    eccentricity,
    topology,
    viewProjectionMatrixUniformBuffer,
    planetsBuffers,
  }: {
    enableArmor: boolean;
    renderPass: GPURenderPassEncoder;
    ellipse_a: number;
    eccentricity: number;
    topology: TopologyEnum;
    viewProjectionMatrixUniformBuffer: GPUBuffer;
    planetsBuffers: PlanetInfo[];
  }) => {
    const modelMatrixUniformBuffer = setModelMatrixUniformBuffer({
      ellipse_a,
      eccentricity,
    });
    const pipeline = getPipelineBasedOnCurrentTopology(topology);

    for (let i = 0; i < planetsCount; i++) {
      const dynamicOffset = i * modelMatrixUniformBufferSize;

      const { vertexBuffer, indexBuffer, indices, texture } = planetsBuffers[i];

      // Bind Group
      const bindGroup = device.createBindGroup({
        label: "bind group element",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: {
              buffer: viewProjectionMatrixUniformBuffer,
            },
          },
          {
            binding: 1,
            resource: {
              buffer: modelMatrixUniformBuffer,
              size: modelMatrixUniformBufferSize,
            },
          },
          { binding: 2, resource: sampler },
          { binding: 3, resource: texture!.createView() },
        ],
      });

      renderPass.setPipeline(pipeline);
      renderPass.setVertexBuffer(0, vertexBuffer); // position and texCoords
      renderPass.setIndexBuffer(indexBuffer, "uint32");
      renderPass.setBindGroup(0, bindGroup, [dynamicOffset]);
      renderPass.drawIndexed(indices.length);

      if (enableArmor) {
        renderPass.setPipeline(armorPipeline);
        renderPass.drawIndexed(indices.length);
      }
    }
  };

  return {
    getNumberOfPlanets,
    renderPlanets,
    getAllModelMatrices,
    getModelMatrixUniformBufferSize,
  };
};
