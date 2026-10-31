/**
 * Where vegetation actually lands in a chunk.
 *
 * Placement is deliberately separate from species selection (`species.ts`) and
 * from sculpting (`stamps.ts`): this file only owns the jittered grid, the
 * cheap rejection tests and the terrain queries. A new species never has to
 * touch it.
 *
 * Each 6 x 6 cell may hold at most one plant whose position and species are
 * pure functions of the cell, so every chunk can stamp its part of a tree
 * without asking its neighbours.
 */
import { ID } from "../blocks";
import { CHUNK_SIZE, MAX_BUILD_HEIGHT, type ChunkWriter } from "../chunk";
import { hash2, valueNoise } from "../noise";
import type { Terrain } from "../terrain";
import { selectSpecies } from "./species";

const CELL = 6;
const MARGIN = 9;

/**
 * Geological surface clutter is derived from terrain and climate, never from
 * hand-authored placements. Small clusters create scree, exposed stones and
 * mossy forest-floor rocks while leaving natural clearings.
 */
function placeSurfaceGeology(writer: ChunkWriter, terrain: Terrain, seed: number): void {
  for (let x = writer.startX; x < writer.startX + CHUNK_SIZE; x += 1) {
    for (let z = writer.startZ; z < writer.startZ + CHUNK_SIZE; z += 1) {
      const column = terrain.column(x, z);
      if (column.water > column.ground || column.ground >= MAX_BUILD_HEIGHT - 2) continue;
      const roll = hash2(x, z, seed + 8911);
      const patch = valueNoise(x, z, 11, seed + 8917);
      const y = column.ground + 1;
      if (column.slope >= 2 || column.biome === "mountain") {
        if (roll < 0.075) {
          const rock = column.rock;
          writer.setIfAir(x, y, z, rock);
          if (roll < 0.028) {
            const dx = hash2(x, z, seed + 8921) > 0.5 ? 1 : -1;
            const dz = hash2(x, z, seed + 8923) > 0.5 ? 1 : 0;
            writer.setIfAir(x + dx, y, z + dz, rock);
            if (patch > 0.58) writer.setIfAir(x - dx, y, z - dz, ID.gravel);
          } else if (patch > 0.62) {
            writer.setIfAir(x + 1, y, z, ID.gravel);
          }
        } else if (roll < 0.13 && column.top !== ID.snow) {
          writer.setIfAir(x, y, z, ID.gravel);
        }
      } else if ((column.biome === "forest" || column.biome === "swamp") && roll < 0.018 + patch * 0.018) {
        writer.setIfAir(x, y, z, patch > 0.55 ? ID.moss : column.rock);
      } else if (column.biome === "plains" && roll < 0.006 && patch > 0.64) {
        writer.setIfAir(x, y, z, ID.gravel);
      }
    }
  }
}

export function placeVegetation(writer: ChunkWriter, terrain: Terrain, seed: number): void {
  placeSurfaceGeology(writer, terrain, seed);
  const { startX, startZ } = writer;
  const minCellX = Math.floor((startX - MARGIN) / CELL);
  const maxCellX = Math.floor((startX + CHUNK_SIZE - 1 + MARGIN) / CELL);
  const minCellZ = Math.floor((startZ - MARGIN) / CELL);
  const maxCellZ = Math.floor((startZ + CHUNK_SIZE - 1 + MARGIN) / CELL);

  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
      const x = cellX * CELL + Math.floor(hash2(cellX, cellZ, seed + 2801) * CELL);
      const z = cellZ * CELL + Math.floor(hash2(cellX, cellZ, seed + 2803) * CELL);
      // Cheap rejection before the (cached) column lookup.
      if (!writer.overlaps(x - MARGIN, z - MARGIN, x + MARGIN, z + MARGIN)) continue;

      const column = terrain.column(x, z);
      if (column.water > column.ground) continue;
      const species = selectSpecies({ column, cellX, cellZ, seed });
      if (!species) continue;
      species.stamp(writer, x, column.ground, z, seed, column);
    }
  }
}
