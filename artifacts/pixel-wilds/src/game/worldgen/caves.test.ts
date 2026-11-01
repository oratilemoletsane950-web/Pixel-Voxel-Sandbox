import assert from "node:assert/strict";
import test from "node:test";

import { ID } from "../blocks";
import { CHUNK_SIZE } from "../chunk";
import { createWorld, getBlockId, getChunk, getTerrain } from "../world";
import { caveEntranceForChunk } from "./caves";

function inEntrance(entrance: { x: number; z: number; run: number }, x: number, z: number): boolean {
  return x >= entrance.x - 1 && x <= entrance.x + 1 &&
    z >= entrance.z - entrance.run - 1 && z <= entrance.z + 1;
}

test("caves carve underground rock without opening the surface", () => {
  const seed = 42;
  const world = createWorld(seed, 0, 0, 1);
  const terrain = getTerrain(seed);
  let carved = 0;

  for (let cx = -1; cx <= 1; cx += 1) {
    for (let cz = -1; cz <= 1; cz += 1) {
      const entrance = caveEntranceForChunk(terrain, cx, cz);
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
          const x = cx * CHUNK_SIZE + lx;
          const z = cz * CHUNK_SIZE + lz;
          const column = terrain.column(x, z);
          if (column.water > column.ground) continue;

          assert.equal(getBlockId(world, x, 0, z), ID.bedrock, "bedrock must survive carving");
          if (entrance && inEntrance(entrance, x, z)) continue;
          assert.notEqual(
            getBlockId(world, x, column.ground, z),
            0,
            "caves must leave a solid surface block outside entrances",
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

test("a generated cave entrance is a walkable descending stair with a lit landing", () => {
  const terrain = getTerrain(2026);
  let found: { seed: number; cx: number; cz: number; entrance: NonNullable<ReturnType<typeof caveEntranceForChunk>> } | null = null;
  for (let seed = 1; seed <= 40 && !found; seed += 1) {
    const probe = getTerrain(seed);
    for (let cx = -3; cx <= 3 && !found; cx += 1) {
      for (let cz = -3; cz <= 3 && !found; cz += 1) {
        const entrance = caveEntranceForChunk(probe, cx, cz);
        if (entrance) found = { seed, cx, cz, entrance };
      }
    }
  }
  assert.ok(found, "expected at least one deterministic entrance across the sample");
  const world = createWorld(found.seed, found.entrance.x, found.entrance.z, 2);
  const entrance = found.entrance;

  // The ramp starts at the surface block and each step leaves headroom.
  assert.equal(
    getBlockId(world, entrance.x, entrance.ground - 1, entrance.z - 1),
    ID.stone_bricks,
    "the first stair tread is solid",
  );
  for (let step = 1; step <= entrance.run; step += 1) {
    const floor = getBlockId(world, entrance.x, entrance.ground - step, entrance.z - step);
    assert.equal(floor, ID.stone_bricks, `stair ${step} needs a floor`);
    assert.equal(
      getBlockId(world, entrance.x, entrance.ground - step + 1, entrance.z - step),
      0,
      `stair ${step} needs headroom`,
    );
  }
  const landingZ = entrance.z - entrance.run;
  const landingY = entrance.ground - entrance.run;
  assert.equal(getBlockId(world, entrance.x, landingY - 1, landingZ), ID.cobblestone);
  assert.ok(
    getBlockId(world, entrance.x + 1, landingY + 1, landingZ - 1) === ID.glow_crystal ||
      getBlockId(world, entrance.x, landingY + 1, landingZ) === ID.glow_crystal,
    "the landing should be lit by a glow crystal",
  );
  assert.ok(terrain.seed >= 0);
});

test("underground caves are dressed with moss, mushrooms or glow crystals", () => {
  const seed = 42;
  const world = createWorld(seed, 0, 0, 2);
  let decorated = 0;
  for (let x = -32; x <= 32; x += 1) {
    for (let z = -32; z <= 32; z += 1) {
      for (let y = 3; y < 100; y += 1) {
        const block = getBlockId(world, x, y, z);
        if (block === ID.cave_moss || block === ID.mushroom || block === ID.glow_crystal) {
          decorated += 1;
          if (decorated > 10) break;
        }
      }
      if (decorated > 10) break;
    }
    if (decorated > 10) break;
  }
  assert.ok(decorated > 3, `expected cave dressing, found ${decorated}`);
});
