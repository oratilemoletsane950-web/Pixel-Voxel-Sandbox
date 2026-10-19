import assert from "node:assert/strict";
import test from "node:test";

import { ID, IS_SOLID } from "./blocks";
import { columnKey } from "./noise";
import { groundCoverType } from "./trees";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./chunk";
import {
  createWorld,
  ensureChunks,
  findSpawnPoint,
  getBlock,
  getBlockId,
  getChunk,
  getChunkCoordinates,
  getTerrain,
  setBlock,
  type WorldData,
} from "./world";

function bytesAt(world: WorldData, cx: number, cz: number): Uint8Array {
  const chunk = getChunk(world, cx * CHUNK_SIZE, cz * CHUNK_SIZE);
  assert.ok(chunk, `expected chunk ${cx},${cz} to be loaded`);
  return chunk.blocks.slice();
}

test("spawn selection returns a position above solid ground with headroom", () => {
  const world = createWorld(314159, 0, 0, 2);
  const spawn = findSpawnPoint(world, 0, 0);
  const x = Math.floor(spawn.x);
  const z = Math.floor(spawn.z);
  const groundY = Math.floor(spawn.y - 3.7 - 1);
  const groundId = getBlockId(world, x, groundY, z);

  assert.ok(IS_SOLID[groundId] === 1, "spawn must stand on a solid block");
  for (let y = groundY + 1; y <= groundY + 6; y += 1) {
    assert.equal(getBlockId(world, x, y, z), 0, `spawn headroom blocked at y=${y}`);
  }
  assert.notEqual(spawn.y, 100, "must not use the old arbitrary sky fallback");
});

test("streamed chunks regenerate deterministically when revisited", () => {
  let world = createWorld(271828, 0, 0, 1);
  const before = bytesAt(world, 0, 0);
  const far = getChunkCoordinates(256, 256);
  world = ensureChunks(world, far.x, far.z, 1, 100);
  world = ensureChunks(world, 0, 0, 1, 100);
  const after = bytesAt(world, 0, 0);
  assert.equal(before.length, CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  assert.deepEqual(after, before);
});


test("saved edits cannot spill into neighbouring chunks", () => {
  const world: WorldData = {
    seed: 12345,
    chunks: {},
    edits: {
      "0,0": {
        "1,5,1": "gold",
        // A malformed save must not write into chunk 1,0 via a wrapped array index.
        "16,5,0": "gold",
      },
    },
  };
  const loaded = ensureChunks(world, 0, 0, 0, 1);
  assert.equal(getBlock(loaded, 1, 5, 1), "gold");
  assert.equal(getBlockId(loaded, 16, 5, 0), 0, "out-of-chunk edit must be ignored");
});

test("block edits reject fractional coordinates and invalid vertical bounds", () => {
  const world = createWorld(8675309, 0, 0, 1);
  const before = getBlockId(world, 1, 5, 1);
  assert.equal(setBlock(world, 1.5, 5, 1, "gold"), world);
  assert.equal(setBlock(world, 1, 5.5, 1, "gold"), world);
  assert.equal(setBlock(world, 1, WORLD_HEIGHT, 1, "gold"), world);
  assert.equal(getBlockId(world, 1, 5, 1), before);
});


test("terrain columns expose deterministic normalized environmental inputs", () => {
  const terrain = getTerrain(424242);
  const first = terrain.column(12, -31);
  const second = terrain.column(12, -31);
  assert.deepEqual(first, second);
  for (const value of [first.sunlight, first.windExposure, first.soilFertility]) {
    assert.ok(value >= 0 && value <= 1, "environment values must be normalized");
  }
  assert.ok(["organic", "loam", "clay", "sand", "rock"].includes(first.soilComposition));
});

test("world generation builds a solid bedrock base and coherent surface strata", () => {
  const world = createWorld(987654, 0, 0, 1);
  const terrain = getTerrain(world.seed);
  for (const [x, z] of [[0, 0], [3, 7], [-4, 2], [15, -1]] as const) {
    const column = terrain.column(x, z);
    assert.equal(getBlockId(world, x, 0, z), ID.bedrock, "every column starts with bedrock");
    if (column.ground > 2) {
      assert.equal(getBlockId(world, x, column.ground, z), column.top, "surface block matches terrain classification");
      assert.notEqual(getBlockId(world, x, column.ground - 1, z), 0, "subsurface is filled below the surface");
    }
    if (column.water > column.ground) {
      assert.equal(getBlockId(world, x, column.water, z), column.temperature < 0.36 ? ID.ice : ID.water);
    }
  }
});

test("seeded climate rules generate diverse biomes and ground-cover species", () => {
  const seed = 42;
  const terrain = getTerrain(seed);
  const biomes = new Set<string>();
  const cover = new Set<number>();
  for (let x = -1024; x <= 1024; x += 16) {
    for (let z = -1024; z <= 1024; z += 16) {
      const column = terrain.column(x, z);
      biomes.add(column.biome);
      const plant = groundCoverType(column, x, z, seed);
      if (plant !== null) cover.add(plant);
    }
  }
  for (const biome of ["rainforest", "savanna", "badlands", "fungal", "alpine"]) {
    assert.ok(biomes.has(biome), `seeded map should contain ${biome} terrain`);
  }
  for (const species of [ID.fern, ID.tall_grass, ID.reed, ID.mushroom]) {
    assert.ok(cover.has(species), `seeded ecology should place ground cover block ${species}`);
  }
});

test("world seeds reject unsafe values at the generation boundary", () => {
  assert.throws(() => createWorld(-1, 0, 0, 0), RangeError);
  assert.throws(() => createWorld(1.5, 0, 0, 0), RangeError);
  assert.throws(() => createWorld(2_147_483_648, 0, 0, 0), RangeError);
});

test("column cache keys remain unique outside the old packed-coordinate range", () => {
  assert.notEqual(columnKey(0, 0), columnKey(0, 2_200_000));
  assert.notEqual(columnKey(-2_000_000, 5), columnKey(-1_999_999, 5));
});
