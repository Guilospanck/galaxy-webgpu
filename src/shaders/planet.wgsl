struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) texCoord: vec2<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@group(0) @binding(0)
var<uniform> viewProjectionMatrix: mat4x4<f32>;

@group(0) @binding(1)
var<uniform> modelMatrix: mat4x4<f32>;

@vertex
fn main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = viewProjectionMatrix * modelMatrix * vec4<f32>(input.position, 1.0);
  output.uv = input.texCoord;
  return output;
}

@group(0) @binding(2)
var textureSampler: sampler;
@group(0) @binding(3)
var sphereTexture: texture_2d<f32>;

@fragment
fn main_fragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(sphereTexture, textureSampler, uv);
}

