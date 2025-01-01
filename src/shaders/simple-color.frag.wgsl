@group(0) @binding(1)
var starTexture: texture_2d<f32>;
@group(0) @binding(2)
var starSampler: sampler;

@fragment
fn main_fragment(@location(0) color: vec4<f32>, @location(1) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let texColor = textureSample(starTexture, starSampler, uv);
  return color * texColor;
}
