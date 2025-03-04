## (Done) MVP matrix

The view-projection matrix should be the same for all planets because:

- View matrix, which transforms from world coordinates to camera coordinates, will be the same because all the planets are in the world coordinates and the world space does not change;
- Projection matrix, which transforms camera coordinates to NDC, will also be the same as the camera is the same.

The only thing that changes is the model matrix because each planet will have a different position in the universe.

Therefore, we need to update the `uniform` to be specific for each planet. We will have two uniforms:

```wgsl
// This is global. It doesn't change. Will be update outside of the frame loop
@group(0) @binding(0)
var<uniform> viewProjectionMatrix: mat4x4<f32>;

// This is per-object. Needs to be updated each frame (Different bind group)
@group(1) @binding(0)
var<uniform> modelMatrix: mat4x4<f32>;
```

## (Done) Model (planet) and camera animation

We need to animate the model (using the model matrix) and not the camera (using the view matrix); the camera should move only by the pointer events (or dat.gui) - pan, zoom, rotate - coming from the user.

## (Done) Buffers

It's better to have one buffer holding the vertices and textcoords because of performance [reasons](https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html#a-pack-verts).

## (Done) Planets movement

Make use of cos, sen and radius to make the planets go around in a orbit-like. Add randomness. (use ellipse formula).

## (Done) Add FPS UI

Check https://github.com/mrdoob/stats.js

## (Done) Add collision

## (Done) Type `planetsBuffers`

## (Done) Check ellipse movement

## (Done) Add parametrization to planet movements

## (Done) Parametrise the `primitive` topology

primitive: { topology: "triangle-list" }, // Change this to `point-list` to have a "see-through"

## (Done) Parametrise the lat and long bands

## (Done) Check camera movement

Not sure it is working properly.

## (Done) Refactor and improve code

DONE: fix the latBands and longBands not updating current rendered planets
DONE: fix the UI not updating when planets change (collisions creates a new planet)
DONE: change from arrow function to regular functions inside functional components.

## Check collisions

TODO: Check if the parallelism in the collision computing is being done right now that the variables have changed
TODO: check if the collisions are working properly after that.

## (Ongoing, so far it creates a new planet) Add some collision effect

## Add resize observer to the canvas
