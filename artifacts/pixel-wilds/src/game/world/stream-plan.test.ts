import assert from "node:assert/strict";
import test from "node:test";

import { chunkKey } from "../chunk";
import { ChunkStreamPlanner } from "./stream-plan";
import type { WorldData } from "./types";

function emptyWorld(): WorldData {
  return { seed: 123, chunks: {}, edits: {} };
}

function addChunk(world: WorldData, cx: number, cz: number): void {
  world.chunks[chunkKey(cx, cz)] = {
    cx,
    cz,
    blocks: new Uint8Array(1),
    version: 0,
    maxY: 0,
    solidCount: 0,
  };
}

test("planner asks for a circular ring and prioritises the look direction", () => {
  const world = emptyWorld();
  const planner = new ChunkStreamPlanner(2);
  const missing = planner.missing(world, { x: 0, z: 0 }, { x: 0, z: -1 });

  assert.ok(missing.length > 0);
  assert.ok(missing.every((chunk) => chunk.distance <= 6.25));
  assert.deepEqual(
    missing.slice(0, 3).map(({ x, z }) => `${x},${z}`),
    ["0,-1", "-1,-1", "1,-1"],
    "the nearest chunks in front must be requested before chunks behind the player",
  );
  assert.ok(missing[0].ahead > missing[missing.length - 1].ahead);
});

test("planner prunes only chunks outside the keep ring", () => {
  const world = emptyWorld();
  addChunk(world, 0, 0);
  addChunk(world, 3, 0);
  addChunk(world, 8, 0);
  const planner = new ChunkStreamPlanner(2);
  const pruned = planner.prune(world, { x: 0, z: 0 });

  assert.ok(pruned);
  assert.equal(Object.keys(pruned.chunks).length, 2);
  assert.ok(pruned.chunks[chunkKey(0, 0)]);
  assert.ok(pruned.chunks[chunkKey(3, 0)]);
  assert.equal(pruned.chunks[chunkKey(8, 0)], undefined);
  assert.equal(planner.prune(pruned, { x: 0, z: 0 }), null, "a settled ring is not copied again");
});

test("planner can cap a batch without losing the rest of the ring", () => {
  const world = emptyWorld();
  const planner = new ChunkStreamPlanner(3);
  const all = planner.missing(world, { x: 4, z: -7 }, { x: 1, z: 0 });
  const batch = planner.missing(world, { x: 4, z: -7 }, { x: 1, z: 0 }, 3);

  assert.equal(batch.length, 3);
  assert.ok(all.length > batch.length);
  assert.deepEqual(batch, all.slice(0, 3));
});
