/**
 * Caves: deterministic chambers and tunnels below the soil.
 *
 * The pass is a pure function of world coordinates, so two neighbouring chunks
 * agree at their shared face and revisiting a chunk regenerates exactly the
 * same cave. It leaves a three-block roof (two blocks plus the surface) so
 * vegetation, spawn safety and hydrology do not get holes punched through
 * them; caves are discovered by mining, not by falling through the meadow.
 */
import { ID } from "../blocks";
import { CHUNK_SIZE, WORLD_HEIGHT, chunkIndex, type ChunkWriter } from "../chunk";
import { valueNoise3 } from "../noise";
import type { Terrain } from "../terrain";
import type { ChunkStage, GenerationContext } from "./types";

const CARVEABLE = new Set<number>([ID.stone, ID.granite, ID.limestone, ID.sandstone]);
const MIN_CAVE_Y = 3;
const SURFACE_ROOF = 3;

function caveField(x: number, y: number, z: number, seed: number): number {
  const broad = valueNoise3(x, y * 1.6, z, 30, seed + 9101);
  const detail = valueNoise3(x, y * 1.6, z, 13, seed + 9137);
  return broad * 0.72 + detail * 0.28;
}

export function carveCaves(writer: ChunkWriter, terrain: Terrain, seed: number): void {
  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      const x = writer.startX + lx;
      const z = writer.startZ + lz;
      const column = terrain.column(x, z);
      // Never open a cave directly under a lake or river.
      if (column.water > column.ground) continue;
      const top = Math.min(WORLD_HEIGHT - 1, column.ground - SURFACE_ROOF);
      for (let y = MIN_CAVE_Y; y <= top; y += 1) {
        const field = caveField(x, y, z, seed);
        const chamber = field > 0.7;
        const tunnel = Math.abs(field - 0.5) < 0.028;
        if (!chamber && !tunnel) continue;
        const index = chunkIndex(lx, y, lz);
        if (CARVEABLE.has(writer.blocks[index])) writer.blocks[index] = 0;
      }
    }
  }
}

export const caveStage: ChunkStage = Object.freeze({
  id: "caves",
  order: 25,
  run: ({ writer, terrain, seed }: GenerationContext) => carveCaves(writer, terrain, seed),
});
