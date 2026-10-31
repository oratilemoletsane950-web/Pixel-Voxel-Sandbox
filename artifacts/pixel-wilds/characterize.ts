/**
 * Behavioural fingerprint of the world-generation pipeline.
 *
 * This is not a test of new behaviour: it hashes the output of the existing
 * terrain, chunk-generation, spawn and block-table code so a refactor can be
 * proven to preserve gameplay exactly. Run it before and after a structural
 * change and diff the two JSON files.
 *
 *   npx tsx characterize.ts > /tmp/before.json
 */
import { createHash } from "node:crypto";

import { BLOCK_ID, BLOCK_TYPES, IS_OPAQUE, IS_SOLID, WORLD_BLOCK_TYPES } from "./src/game/blocks";
import { CHUNK_SIZE } from "./src/game/chunk";
import { CRAFTING_RECIPES } from "./src/game/crafting";
import { Terrain } from "./src/game/terrain";
import { createWorld, findSpawnPoint, getBlockId, getTerrain } from "./src/game/world";

const SEEDS = [0, 1, 42, 271828, 2026] as const;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

function chunkFingerprint(seed: number, radius: number): string {
  const world = createWorld(seed, 0, 0, radius);
  const chunks = Object.keys(world.chunks)
    .sort()
    .map((key) => {
      const chunk = world.chunks[key];
      return [key, Array.from(chunk.blocks), chunk.maxY, chunk.solidCount];
    });
  return digest(chunks);
}

function columnFingerprint(seed: number): string {
  const terrain = getTerrain(seed);
  const rows: unknown[] = [];
  for (let x = -80; x <= 80; x += 7) {
    for (let z = -80; z <= 80; z += 7) {
      const c = terrain.column(x, z);
      rows.push([
        x, z, c.biome, c.top, c.soil, c.soilDepth, c.mid, c.midDepth, c.rock,
        c.ground, c.water, c.riverDist, c.riverHalfWidth, c.broad, c.mountain,
        c.slope, c.temperature, c.moisture, c.frozen, c.sunlight, c.windExposure,
        c.soilFertility, c.soilComposition, c.geologicalComposition, c.rainfall,
        c.elevation,
      ]);
    }
  }
  return digest(rows);
}

function biomeHistogram(seed: number): Record<string, number> {
  const terrain = new Terrain(seed);
  const counts: Record<string, number> = {};
  for (let x = -512; x <= 512; x += 4) {
    for (let z = -512; z <= 512; z += 4) {
      const biome = terrain.column(x, z).biome;
      counts[biome] = (counts[biome] ?? 0) + 1;
    }
  }
  return counts;
}

const result = {
  blockTypes: BLOCK_TYPES,
  worldBlockTypes: WORLD_BLOCK_TYPES,
  blockIds: BLOCK_ID,
  solidTable: Array.from(IS_SOLID),
  opaqueTable: Array.from(IS_OPAQUE),
  recipes: CRAFTING_RECIPES,
  seeds: SEEDS.map((seed) => ({
    seed,
    columns: columnFingerprint(seed),
    biomes: digest(biomeHistogram(seed)),
    chunks1: chunkFingerprint(seed, 1),
    chunks2: chunkFingerprint(seed, 2),
    spawn: findSpawnPoint(createWorld(seed, 0, 0, 1), 0, 0),
    blockAt: [getBlockId(createWorld(seed, 0, 0, 0), 3, 20, 3)],
    chunkSize: CHUNK_SIZE,
  })),
};

console.log(JSON.stringify(result, null, 2));
