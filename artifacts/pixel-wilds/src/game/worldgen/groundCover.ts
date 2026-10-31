/**
 * Ground-cover pass: wildflowers and the small scenery plants (ferns, meadow
 * grass, reeds, mushrooms) that dress the surface without blocking movement.
 *
 * Kept as its own stage so the ecological rules in `vegetation/ground-cover.ts`
 * can be tuned, extended or replaced without touching geology, ores or trees.
 */
import { ID } from "../blocks";
import { CHUNK_SIZE } from "../chunk";
import { hasFlower } from "../vegetation/flowers";
import { groundCoverType } from "../vegetation/ground-cover";
import type { ChunkStage, GenerationContext } from "./types";

export const groundCoverStage: ChunkStage = Object.freeze({
  id: "ground-cover",
  order: 30,
  run: ({ writer, terrain, seed }: GenerationContext) => {
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        const x = writer.startX + lx;
        const z = writer.startZ + lz;
        const column = terrain.column(x, z);
        if (column.water > column.ground) continue;
        const cover = hasFlower(column, x, z, seed) ? ID.flower : groundCoverType(column, x, z, seed);
        if (cover !== null) writer.setIfAir(x, column.ground + 1, z, cover);
      }
    }
  },
});
