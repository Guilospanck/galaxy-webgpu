import "./style.css";

const shaders = `
struct VertexOut {
	@builtin(position) position : vec4f,
	@location(0) color : vec4f
}

@vertex
fn vertex_main(@location(0) position: vec4f, @location(1) color: vec4f) -> VertexOut {
	var output : VertexOut;
	output.position = position;
	output.color = color;
	return output;
}

@fragment
fn fragment_main(fragData: VertexOut) -> @location(0) vec4f {
	return fragData.color;
}
`;

export async function init() {
  if (!navigator.gpu) {
    throw Error("WebGPU not supported.");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw Error("Couldn't request WebGPU adapter.");
  }

  const device = await adapter.requestDevice();

  // 1 - make shader available to WebGPU
  const shaderModule = device.createShaderModule({
    code: shaders,
  });

  // 2 - Get and configure canvas context
  const canvas = <HTMLCanvasElement>document.querySelector("#galaxy");
  const context = canvas.getContext("webgpu");
  context.configure({
    device: device,
    format: navigator.gpu.getPreferredCanvasFormat(), // best practice
    alphaMode: "premultiplied",
  });

  // 3 - Create buffer and write data into it
  const NUMBER_OF_VERTICES = 3;
  const vertices = new Float32Array([
    // x, y, z, w, R, G, B, A   (position: (x,y,z,w) and color: RGBA)
    0.0,
    0.6,
    0,
    1,
    1,
    0,
    0,
    1, // first triangle vertex

    -0.5,
    -0.6,
    0,
    1,
    0,
    1,
    0,
    1, // second triangle vertex

    0.5,
    -0.6,
    0,
    1,
    0,
    0,
    1,
    1, // third triangle vertex
  ]);
  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength, // make it big enough to store vertices in
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, // will be used as a vertex buffer and the destination of copy operations
  });
  //           writeBuffer(buffer, bufferOffset, data, dataOffset, size)
  device.queue.writeBuffer(vertexBuffer, 0, vertices, 0, vertices.length);

  // 4 - Define and create the render pipeline
  const vertexBuffers = [
    {
      attributes: [
        {
          shaderLocation: 0, // position (see the `shaders` for the @location(0))
          offset: 0,
          format: "float32x4",
        },
        {
          shaderLocation: 1, // color (see the `shaders` for the @location(1))
          offset: vertices.BYTES_PER_ELEMENT * 4, // the color appears after 4 elements of position (x,y,z,w)
          format: "float32x4",
        },
      ],
      arrayStride: vertices.BYTES_PER_ELEMENT * 8, // each vertex is defined by 8 elements (4 for position and 4 for color)
      stepMode: "vertex",
    },
  ];
  const pipelineDescriptor = {
    vertex: {
      module: shaderModule,
      entryPoint: "vertex_main", // name defined in the `shaders`
      buffers: vertexBuffers,
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fragment_main", // name defined in the `shaders`
      targets: [
        {
          format: navigator.gpu.getPreferredCanvasFormat(),
        },
      ],
    },
    primitive: {
      topology: "triangle-list",
    },
    layout: "auto",
  };
  const renderPipeline = device.createRenderPipeline(pipelineDescriptor);

  // 5 - Running a rendering pass
  const commandEncoder = device.createCommandEncoder(); // encoder to encode any commands to be sent to the GPU

  const clearColor = { r: 0.0, g: 0.5, b: 1.0, a: 1.0 };
  const renderPassDescriptor = {
    colorAttachments: [
      {
        clearValue: clearColor,
        loadOp: "clear", // on load, clear (using the clearValue)
        storeOp: "store",
        view: context.getCurrentTexture().createView(), // color the texture of the canvas
      },
    ],
  };

  const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
  passEncoder.setPipeline(renderPipeline);
  passEncoder.setVertexBuffer(0, vertexBuffer); // the index (0) is a reference to the index inside vertexBuffer
  passEncoder.draw(NUMBER_OF_VERTICES);
  passEncoder.end(); // finish the render pass command list

  device.queue.submit([commandEncoder.finish()]); // sends the commands to the GPU
}
