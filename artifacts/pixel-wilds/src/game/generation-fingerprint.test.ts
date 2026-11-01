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
  42: "e5fb57e0d9fc3b9f56d3bd94d728a766de6692370b7bfcbf02931e373671973f",
  2026: "3c9b1d1ce6b0d24c104bcb917c5a80a5c1b550c97b54ca82be4c7001814436c9",
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
