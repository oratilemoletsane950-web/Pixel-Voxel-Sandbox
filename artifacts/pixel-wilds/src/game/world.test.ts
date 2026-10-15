import assert from "node:assert/strict";
import test from "node:test";

import { IS_SOLID } from "./blocks";
import { CHUNK_SIZE, WORLD_HEIGHT } from "./chunk";
import {
  createWorld,
  ensureChunks,
  findSpawnPoint,
  getBlockId,
  getChunk,
  getChunkCoordinates,
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
