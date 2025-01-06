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

struct CollisionPairs {
  a: u32,
  b: u32,
}

struct Collision {
  count: atomic<u32>,
  data: array<CollisionPairs>,
}

struct CenterAndRadius {
  x: f32,
  y: f32,
  z: f32,
  r: f32,
}

@group(0) @binding(0) var<storage, read_write> planetsCenterPointInWorldSpaceAndRadius: array<CenterAndRadius>;
@group(0) @binding(1) var<storage, read_write> collisions: Collision;

fn check_collision(a: CenterAndRadius, b: CenterAndRadius) -> bool {
  let radiusA = a.r;
  let radiusB = b.r;

  let xA = a.x;
  let yA = a.y;
  let zA = a.z;

  let xB = b.x;
  let yB = b.y;
  let zB = b.z;

  let dx = xB - xA;
  let dy = yB - yA;
  let dz = zB - zA;
  let distanceCAandCBSquared = dx * dx + dy * dy + dz * dz;

  let sumOfRadius = radiusA + radiusB;

  let collided = distanceCAandCBSquared <= sumOfRadius * sumOfRadius;

  return collided;
}

@compute @workgroup_size(1)
fn compute_collision(@builtin(global_invocation_id) globalID: vec3u) {
  let currentPlanetCenterPoint = planetsCenterPointInWorldSpaceAndRadius[globalID.x];

  for (var i =  0u; i < arrayLength(&planetsCenterPointInWorldSpaceAndRadius); i++) {
    if (i == globalID.x) {continue;}
    let checkingPlanetCenterPoint = planetsCenterPointInWorldSpaceAndRadius[i];

    if (check_collision(currentPlanetCenterPoint, checkingPlanetCenterPoint)) {
      let index = atomicAdd(&collisions.count, 1); // Atomically get the next index
      let pair = CollisionPairs(globalID.x, i);
      collisions.data[index] = pair;
    }
  }
}

