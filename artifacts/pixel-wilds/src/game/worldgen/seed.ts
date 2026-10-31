/** Seed validation used at world boundaries and by save/load entry points. */
export function normalizeWorldSeed(seed: number): number {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2_147_483_647) {
    throw new RangeError("World seed must be an integer between 0 and 2147483647.");
  }
  return seed;
}
