import assert from "node:assert/strict";
import test from "node:test";

import { createWorld, setBlock } from "./index";
import { caveLightsNear } from "./cave-light";

function roomWorld() {
  let world = createWorld(42, 0, 0, 1);
  // Carve a clean 7x5x7 room so generated terrain cannot affect the test.
  for (let x = -3; x <= 3; x += 1) {
    for (let z = -3; z <= 3; z += 1) {
      for (let y = 50; y <= 54; y += 1) {
        const edge = Math.abs(x) === 3 || Math.abs(z) === 3 || y === 50 || y === 54;
        world = setBlock(world, x, y, z, edge ? "stone" : null);
      }
    }
  }
  return world;
}

test("a visible glow crystal becomes a cave light anchor", () => {
  const world = setBlock(roomWorld(), 2, 51, 1, "glow_crystal");
  const lights = caveLightsNear(world, { x: 0.5, y: 51.5, z: 0.5 }, 12);
  assert.equal(lights.length, 1);
  assert.deepEqual(lights[0].position, [2.5, 51.5, 1.5]);
  assert.ok(lights[0].intensity > 0);
});

test("flood-fill visibility rejects a crystal sealed behind a wall", () => {
  let world = setBlock(roomWorld(), 2, 51, 1, "glow_crystal");
  for (let z = -3; z <= 3; z += 1) {
    for (let y = 51; y <= 54; y += 1) world = setBlock(world, 1, y, z, "stone");
  }
  assert.deepEqual(caveLightsNear(world, { x: 0.5, y: 51.5, z: 0.5 }, 12), []);
});
