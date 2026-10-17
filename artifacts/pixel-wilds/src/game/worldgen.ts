/**
 * Ordered, deterministic chunk-generation stages.
 *
 * This module owns geological strata and hydrology only. Ore, vegetation and
 * future climate/ecology passes run as separate stages in world.ts, making
 * dependencies explicit without adding extra full-chunk traversal passes.
 */
import { ID } from "./blocks";
import { CHUNK_SIZE, WORLD_HEIGHT, ChunkWriter } from "./chunk";
import { hash2 } from "./noise";
import type { Terrain } from "./terrain";

export interface GenerationContext {
  readonly seed: number;
  readonly terrain: Terrain;
  readonly writer: ChunkWriter;
}

/** Stage 1: establish the immutable foundation at the bottom of every column. */
function writeBedrockLayer(context: GenerationContext, x: number, z: number, base: number): void {
  context.writer.blocks[base] = ID.bedrock;
  // A deterministic, irregular second bedrock layer prevents a perfectly flat seam.
  if (hash2(x, z, context.seed + 5) < 0.5) context.writer.blocks[base + 1] = ID.bedrock;
}

/** Stage 2: fill deep rock, sedimentary bands, and soil from bottom to top. */
function writeGeologicalColumn(context: GenerationContext, x: number, z: number, base: number): number {
  const column = context.terrain.column(x, z);
  const ground = Math.max(1, Math.min(WORLD_HEIGHT - 1, Math.floor(column.ground)));
  for (let y = 1; y <= ground; y += 1) {
    if (y === 1 && hash2(x, z, context.seed + 5) < 0.5) {
      context.writer.blocks[base + y] = ID.bedrock;
      continue;
    }
    const depth = ground - y;
    let id: number;
    if (depth === 0) id = column.top;
    else if (depth <= column.soilDepth) id = column.soil;
    else if (depth <= column.soilDepth + column.midDepth) id = column.mid || column.rock;
    else id = column.rock;
    context.writer.blocks[base + y] = id;
  }
  return ground;
}

/** Stage 3: fill lakes, seas and river channels after their beds are generated. */
function writeHydrologyColumn(context: GenerationContext, x: number, z: number, base: number, ground: number): void {
  const column = context.terrain.column(x, z);
  if (column.water <= ground) return;
  const waterTop = Math.min(WORLD_HEIGHT - 1, Math.floor(column.water));
  for (let y = ground + 1; y <= waterTop; y += 1) {
    context.writer.blocks[base + y] =
      column.temperature < 0.36 && y === waterTop ? ID.ice : ID.water;
  }
}

/**
 * Run the ordered bedrock -> geology -> surface -> hydrology stages.
 * Each world column is evaluated once for writing, preserving cache locality.
 */
export function generateGeologicalLayers(writer: ChunkWriter, terrain: Terrain, seed: number): void {
  const context: GenerationContext = { seed, terrain, writer };
  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      const x = writer.startX + lx;
      const z = writer.startZ + lz;
      const base = (lx * CHUNK_SIZE + lz) * WORLD_HEIGHT;
      writeBedrockLayer(context, x, z, base);
      const ground = writeGeologicalColumn(context, x, z, base);
      writeHydrologyColumn(context, x, z, base, ground);
    }
  }
}

/** Seed validation used at world boundaries and by save/load entry points. */
export function normalizeWorldSeed(seed: number): number {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2_147_483_647) {
    throw new RangeError("World seed must be an integer between 0 and 2147483647.");
  }
  return seed;
}
