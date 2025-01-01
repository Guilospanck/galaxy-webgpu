struct VertexInput {
  @location(0) position: vec4<f32>,
  @location(1) color: vec4<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
}

@group(0) @binding(0)
var<uniform> matrices: mat4x4f;

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  let pos = matrices * input.position;
  output.position = pos;
  output.color = input.color;
  output.uv = vec2<f32>(input.position.x * 0.5 + 0.5, input.position.y * 0.5 + 0.5); // UV mapping
  return output;
}
