import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createWorld } from "./world";

/**
 * Generation fingerprint.
 *
 * Hashes the blocks of fully generated chunks so an architectural change
 * cannot silently alter the world. If a change to world generation is
 * intentional, re-record the expected digests (see `characterize.ts` for a
 * wider fingerprint covering terrain columns, biomes and spawn points).
 */
const EXPECTED: Readonly<Record<number, string>> = {
  42: "118d762ea0f5fedad1591438995c8da1bde6cba108f2a0421165c83934734d1f",
  2026: "5747c0f46058cb3845e7261ed47f00a4a1ddeea074e301edc1bed0a80c2ff88c",
};

function digest(seed: number): string {
  const world = createWorld(seed, 0, 0, 1);
  const data = Object.keys(world.chunks)
    .sort()
    .map((key) => {
      const chunk = world.chunks[key];
      return [key, Array.from(chunk.blocks), chunk.maxY, chunk.solidCount];
    });
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

test("world generation matches the recorded fingerprint", () => {
  for (const [seed, expected] of Object.entries(EXPECTED)) {
    assert.equal(digest(Number(seed)), expected, `seed ${seed} generation changed`);
  }
});
