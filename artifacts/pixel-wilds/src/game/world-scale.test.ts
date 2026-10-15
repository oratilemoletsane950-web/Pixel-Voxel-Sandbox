import assert from "node:assert/strict";
import test from "node:test";

import { MAX_BUILD_HEIGHT } from "./chunk";
import { Terrain } from "./terrain";

test("mountain relief is substantial, deterministic, and remains inside chunk height", () => {
  for (const seed of [42, 2026]) {
    const terrain = new Terrain(seed);
    let min = Infinity;
    let max = -Infinity;
    for (let x = -1024; x <= 1024; x += 32) {
      for (let z = -1024; z <= 1024; z += 32) {
        const a = terrain.natural(x, z);
        const b = terrain.natural(x, z);
        assert.equal(a.ground, b.ground, "terrain sampling must be deterministic");
        assert.ok(a.ground >= 4 && a.ground <= MAX_BUILD_HEIGHT - 24);
        min = Math.min(min, a.ground);
        max = Math.max(max, a.ground);
      }
    }
    assert.ok(max >= 115, `seed ${seed} should generate tall mountain regions (peak ${max})`);
    assert.ok(max - min >= 65, `seed ${seed} should have meaningful elevation range (${max - min})`);
  }
});
