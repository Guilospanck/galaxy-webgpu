import { vec4 } from "gl-matrix";
import { WORKGROUP_SIZE } from "./constants";
import { CollisionPair } from "./types";
import { Observer } from "./observer";

export const Collisions = ({
  device,
  shaderModule,
}: {
  device: GPUDevice;
  shaderModule: GPUShaderModule;
}) => {
  let planetsCenterPointAndRadiusBuffer: GPUBuffer;
  let collisionsBuffer: GPUBuffer;
  let resultsBuffer: GPUBuffer;
  let computeShaderBindGroup: GPUBindGroup;

  // Bind Group for the compute shader
  const computeShaderBindGroupLayout = device.createBindGroupLayout({
    label: "compute shader custom bind group layout",
    entries: [
      {
        binding: 0, // Planets center point in world space + radius
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: "read-only-storage",
        },
      },
      {
        binding: 1, // collisions
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: "storage",
        },
      },
    ],
  });

  // Compute shader pipeline
  const computeShaderPipeline = device.createComputePipeline({
    label: "compute shader render pipeline",
    layout: device.createPipelineLayout({
      bindGroupLayouts: [computeShaderBindGroupLayout],
    }),
    compute: {
      module: shaderModule,
      entryPoint: "compute_collision",
    },
  });

  function recreateComputeShaderBuffers({
    numberOfPlanets,
    planetsCenterPointsAndRadius,
  }: {
    numberOfPlanets: number;
    planetsCenterPointsAndRadius: vec4[];
  }) {
    planetsCenterPointAndRadiusBuffer = device.createBuffer({
      label: "compute shader planets center points and radius buffer",
      size: numberOfPlanets * Float32Array.BYTES_PER_ELEMENT * 4, // x, y, z, r
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // INFO: This should be the "correct" way of calculating how many possible
    // collisions there area, but this number grows a lot after some time, which
    // makes it incalculable and not efficient for this application. It is also
    // very unlikely that all the planets will collided with all of them (think of
    // all planets being in a single place).
    //
    // One of the possible solutions is to maintain the size of `numberOfPlanets`
    // and then destroy those collided planets, so in the next `checkCollision`
    // iteration they will not exist, giving space for the other collided planets
    // to be checked.
    //
    // The total amount of collision that can exist in the system is given by the
    // formula (simple combination):
    //                          C(n,k)=n!/k!(n-k)!
    // where:
    //              0 <= k <= n
    //
    //              n: number of elements (in our case number of planets)
    //              k: unique k-selections (in our case 2, as we are checking
    //                                the collision from one planet to another)
    //
    // const collisionBufferSize =
    //   calculateFactorial(numberOfPlanets) /
    //   (2 * calculateFactorial(numberOfPlanets - 2));

    collisionsBuffer = device.createBuffer({
      label: "compute shader collision buffer",
      size: numberOfPlanets * 4 * 2 + 4, // (a: u32, b: u32) * planets + count: 32
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST, // INFO: COPY_DST is used for the command encoder to clear the buffer after it is copied into resultsBuffer
    });

    resultsBuffer = device.createBuffer({
      label: "compute shader result buffer",
      size: collisionsBuffer.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    computeShaderBindGroup = device.createBindGroup({
      label: "compute shader bindGroup",
      layout: computeShaderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: planetsCenterPointAndRadiusBuffer } },
        { binding: 1, resource: { buffer: collisionsBuffer } },
      ],
    });

    device.queue.writeBuffer(
      planetsCenterPointAndRadiusBuffer,
      0,
      new Float32Array(
        planetsCenterPointsAndRadius.map((a) => [...a]).flat() as number[],
      ),
    );
  }

  /// Parse collison results buffer
  function parseResultsBuffer({ arrayBuffer }: { arrayBuffer: ArrayBuffer }) {
    const view = new DataView(arrayBuffer.slice(4)); // remove `count`
    const structSize = 2 * 4; // CollisionPair (a: number, b: number)

    const collisions: CollisionPair[] = [];
    for (let i = 0; i < Math.floor(view.byteLength / structSize); i++) {
      const baseOffset = i * structSize;
      const a = view.getUint32(baseOffset, true); // a
      const b = view.getUint32(baseOffset + 4, true); // b

      // INFO: the Collision structure in the shader will have the size of
      // the number of planets. Therefore, if we have less actual collisions than
      // that number, it is using the default value (0).
      // TODO: Check the copyBuffer part. That might do the trick.
      if (a !== b) {
        collisions.push({ a, b });
      }
    }

    console.info(`Collisions found: ${collisions.length}`);
    Observer().notify("collisions", collisions);
  }

  async function checkCollisionViaComputeShader({
    numberOfPlanets,
  }: {
    numberOfPlanets: number;
  }) {
    console.info("Checking collisions...");

    // Create Command Encoder
    const computeShaderCommandEncoder = device.createCommandEncoder({
      label: "compute pass command encoder",
    });

    const computePass = computeShaderCommandEncoder.beginComputePass();
    computePass.setPipeline(computeShaderPipeline);
    computePass.setBindGroup(0, computeShaderBindGroup);

    // dispatch workgroups
    computePass.dispatchWorkgroups(Math.ceil(numberOfPlanets / WORKGROUP_SIZE));
    computePass.end();

    computeShaderCommandEncoder.copyBufferToBuffer(
      collisionsBuffer,
      0,
      resultsBuffer,
      0,
      resultsBuffer.size,
    );

    // clear collisions buffer
    computeShaderCommandEncoder.clearBuffer(collisionsBuffer);

    // Submit Commands
    device.queue.submit([computeShaderCommandEncoder.finish()]);

    await resultsBuffer.mapAsync(GPUMapMode.READ);
    const arrayBuffer = resultsBuffer.getMappedRange();

    // Parse the buffer into a structure
    parseResultsBuffer({
      arrayBuffer,
    });

    // release buffer
    resultsBuffer.unmap();
  }

  return {
    checkCollisionViaComputeShader,
    recreateComputeShaderBuffers,
  };
};
