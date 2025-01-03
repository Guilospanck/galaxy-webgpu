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
  output.uv = vec2<f32>(input.position.x * 0.5 + 0.5, input.position.y * 0.5 + 0.5); // UV mapping (moving coordinates from [-1, 1] to [0, 1])
  return output;
}

@group(0) @binding(1)
var starTexture: texture_2d<f32>;
@group(0) @binding(2)
var starSampler: sampler;

@fragment
fn main_fragment(@location(0) color: vec4<f32>, @location(1) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let texColor = textureSample(starTexture, starSampler, uv);
  return color * texColor;
}
