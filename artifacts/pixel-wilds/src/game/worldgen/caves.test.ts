import assert from "node:assert/strict";
import test from "node:test";

import { ID } from "../blocks";
import { CHUNK_SIZE } from "../chunk";
import { createWorld, getBlockId, getChunk, getTerrain } from "../world";

test("caves carve underground rock without opening the surface", () => {
  const seed = 42;
  const world = createWorld(seed, 0, 0, 1);
  const terrain = getTerrain(seed);
  let carved = 0;

  for (let cx = -1; cx <= 1; cx += 1) {
    for (let cz = -1; cz <= 1; cz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
          const x = cx * CHUNK_SIZE + lx;
          const z = cz * CHUNK_SIZE + lz;
          const column = terrain.column(x, z);
          if (column.water > column.ground) continue;

          assert.equal(getBlockId(world, x, 0, z), ID.bedrock, "bedrock must survive carving");
          assert.notEqual(
            getBlockId(world, x, column.ground, z),
            0,
            "caves must leave a solid surface block",
          );
          assert.notEqual(
            getBlockId(world, x, column.ground - 1, z),
            0,
            "at least a one-block roof must remain below the surface",
          );

          for (let y = 3; y <= Math.min(column.ground - 3, 255); y += 1) {
            if (getBlockId(world, x, y, z) === 0) carved += 1;
          }
        }
      }
    }
  }

  assert.ok(carved > 20, `expected caves to remove some rock, removed ${carved}`);
});

test("cave generation is stable when a chunk is regenerated", () => {
  const first = createWorld(271828, 0, 0, 1);
  const second = createWorld(271828, 0, 0, 1);
  const firstChunk = getChunk(first, 0, 0);
  const secondChunk = getChunk(second, 0, 0);
  assert.ok(firstChunk && secondChunk);
  assert.deepEqual(Array.from(firstChunk.blocks), Array.from(secondChunk.blocks));
});
