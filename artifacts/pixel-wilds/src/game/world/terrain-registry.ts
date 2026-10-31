import { normalizeWorldSeed } from "../worldgen/seed";
import { Terrain } from "../terrain";
import type { Biome } from "../terrain";

/**
 * Terrain instances are expensive to build (they hold large column caches), so
 * at most two seeds are kept alive at a time — enough for the menu to compare a
 * world and the one being played.
 */
const MAX_TERRAINS = 2;
const terrains = new Map<number, Terrain>();

export function getTerrain(seed: number): Terrain {
  normalizeWorldSeed(seed);
  let terrain = terrains.get(seed);
  if (!terrain) {
    terrain = new Terrain(seed);
    if (terrains.size >= MAX_TERRAINS) {
      const oldest = terrains.keys().next().value;
      if (oldest !== undefined) terrains.delete(oldest);
    }
    terrains.set(seed, terrain);
  }
  return terrain;
}

export function getBiomeAt(seed: number, x: number, z: number): Biome {
  return getTerrain(seed).column(Math.floor(x), Math.floor(z)).biome;
}
