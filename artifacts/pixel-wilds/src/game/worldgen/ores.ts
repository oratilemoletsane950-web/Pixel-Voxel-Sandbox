/**
 * Ore veins: small random walks inside stone.
 *
 * Coal is common in shallow-to-mid depths, iron is rarer and deeper, and
 * granite country holds more iron. Each vein is confined to one chunk so the
 * result never depends on load order.
 */
import { ID } from "../blocks";
import { CHUNK_SIZE, WORLD_HEIGHT, chunkIndex, type ChunkWriter } from "../chunk";
import { hash2 } from "../noise";
import type { Terrain } from "../terrain";
import type { ChunkStage, GenerationContext } from "./types";

const ROCKS = new Set<number>([ID.stone, ID.granite, ID.limestone, ID.sandstone]);

export function placeOres(writer: ChunkWriter, terrain: Terrain, seed: number): void {
  const { chunk } = writer;
  const kinds = [
    { id: ID.coal_ore, veins: 9, minY: 10, maxDepthBelowSurface: 5, size: 9 },
    { id: ID.iron_ore, veins: 5, minY: 4, maxDepthBelowSurface: 12, size: 6 },
  ];
  kinds.forEach((kind, kindIndex) => {
    for (let vein = 0; vein < kind.veins; vein += 1) {
      const r = (n: number) => hash2(chunk.cx * 131 + vein * 7 + n, chunk.cz * 137 + kindIndex * 11 + n * 3, seed + 7777);
      const lx = 2 + Math.floor(r(1) * 12);
      const lz = 2 + Math.floor(r(2) * 12);
      const column = terrain.column(writer.startX + lx, writer.startZ + lz);
      const maxY = column.ground - kind.maxDepthBelowSurface;
      if (maxY <= kind.minY) continue;
      if (kind.id === ID.iron_ore && column.rock !== ID.granite && r(9) > 0.5) continue;
      let x = lx;
      let y = kind.minY + Math.floor(r(3) * (maxY - kind.minY));
      let z = lz;
      const size = kind.size + Math.floor(r(4) * 5);
      for (let step = 0; step < size; step += 1) {
        const index = chunkIndex(x, y, z);
        if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && y > 0 && y < WORLD_HEIGHT && ROCKS.has(chunk.blocks[index])) {
          chunk.blocks[index] = kind.id;
        }
        const dir = Math.floor(r(10 + step) * 6);
        if (dir === 0) x += 1;
        else if (dir === 1) x -= 1;
        else if (dir === 2) z += 1;
        else if (dir === 3) z -= 1;
        else if (dir === 4) y += 1;
        else y -= 1;
      }
    }
  });
}

export const oreStage: ChunkStage = Object.freeze({
  id: "ores",
  order: 20,
  run: ({ writer, terrain, seed }: GenerationContext) => placeOres(writer, terrain, seed),
});
