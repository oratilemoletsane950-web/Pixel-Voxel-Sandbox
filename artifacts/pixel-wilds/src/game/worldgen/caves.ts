/**
 * Caves: deterministic chambers, tunnels, entrances and underground dressing.
 *
 * The pass is a pure function of world coordinates, so two neighbouring chunks
 * agree at their shared face and revisiting a chunk regenerates exactly the
 * same cave. The main cave field leaves a three-block roof so vegetation,
 * spawn safety and hydrology do not get holes punched through them. A rare
 * per-chunk staircase entrance is the deliberate exception: it is carved as a
 * walkable ramp with a lit landing so caves can be entered without mining.
 *
 * Glow crystals are real blocks (not just bright pixels) so the renderer can
 * place a small local light near them. Moss and mushrooms dress cave floors
 * and make the underground read differently from a mined tunnel.
 */
import { ID } from "../blocks";
import { CHUNK_SIZE, WORLD_HEIGHT, chunkIndex, type ChunkWriter } from "../chunk";
import { hash2, valueNoise3 } from "../noise";
import type { Terrain } from "../terrain";
import type { ChunkStage, GenerationContext } from "./types";

const CARVEABLE = new Set<number>([ID.stone, ID.granite, ID.limestone, ID.sandstone]);
const MIN_CAVE_Y = 3;
const SURFACE_ROOF = 3;
const ENTRANCE_CHANCE = 0.16;
const ENTRANCE_RUN = 9;
const ENTRANCE_DEPTH = 12;

export interface CaveEntrance {
  /** World-space top of the stair, at the surface. */
  x: number;
  z: number;
  ground: number;
  /** The stair descends toward -z for this many blocks. */
  run: number;
}

function caveField(x: number, y: number, z: number, seed: number): number {
  const broad = valueNoise3(x, y * 1.6, z, 30, seed + 9101);
  const detail = valueNoise3(x, y * 1.6, z, 13, seed + 9137);
  return broad * 0.72 + detail * 0.28;
}

function isEntranceFootprint(entrance: CaveEntrance, x: number, z: number): boolean {
  return x >= entrance.x - 1 && x <= entrance.x + 1 &&
    z >= entrance.z - entrance.run - 1 && z <= entrance.z + 1;
}

/**
 * One entrance is considered per chunk and only when the local surface is dry,
 * not a river bank, and gentle enough for a staircase. The candidate is kept
 * away from chunk borders so the visible entrance is entirely local.
 */
export function caveEntranceForChunk(
  terrain: Terrain,
  chunkX: number,
  chunkZ: number,
): CaveEntrance | null {
  const seed = terrain.seed;
  if (hash2(chunkX, chunkZ, seed + 9029) >= ENTRANCE_CHANCE) return null;
  const x = chunkX * CHUNK_SIZE + 5 + Math.floor(hash2(chunkX, chunkZ, seed + 9041) * 6);
  const z = chunkZ * CHUNK_SIZE + 11;
  const column = terrain.natural(x, z);
  if (column.water > 0 || column.riverDist < column.riverHalfWidth + 4) return null;
  if (column.ground < MIN_CAVE_Y + ENTRANCE_DEPTH + 3 || column.ground > 110) return null;
  let lowest = column.ground;
  let highest = column.ground;
  for (let dz = 0; dz <= ENTRANCE_RUN; dz += 1) {
    const sample = terrain.natural(x, z - dz);
    if (sample.water > 0 || sample.riverDist < sample.riverHalfWidth + 2) return null;
    lowest = Math.min(lowest, sample.ground);
    highest = Math.max(highest, sample.ground);
  }
  if (highest - lowest > 7) return null;
  return { x, z, ground: column.ground, run: ENTRANCE_RUN };
}

function carveEntrance(writer: ChunkWriter, entrance: CaveEntrance, seed: number): void {
  const { x, z, ground, run } = entrance;
  // A three-wide stair ramp: each step drops one block and is two blocks of
  // headroom. The landing opens into a small chamber that meets the cave field.
  for (let step = 0; step <= run; step += 1) {
    const stepZ = z - step;
    const floorY = ground - step;
    for (let dx = -1; dx <= 1; dx += 1) {
      const px = x + dx;
      if (!writer.inside(px, stepZ)) continue;
      writer.set(px, floorY, stepZ, ID.stone_bricks);
      for (let y = floorY + 1; y <= floorY + 3; y += 1) writer.set(px, y, stepZ, 0);
      // Cut the natural roof above the ramp so it reads as an open stair.
      for (let y = floorY + 4; y <= ground + 2; y += 1) writer.set(px, y, stepZ, 0);
    }
  }

  const landingZ = z - run;
  const landingY = ground - run;
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 0; dz += 1) {
      const px = x + dx;
      const pz = landingZ + dz;
      if (!writer.inside(px, pz)) continue;
      writer.set(px, landingY, pz, ID.stone_bricks);
      for (let y = landingY + 1; y <= landingY + 4; y += 1) writer.set(px, y, pz, 0);
      writer.set(px, landingY - 1, pz, ID.cobblestone);
    }
  }

  // Continue a rough tunnel away from the stair. It follows the cave field
  // where possible and always leaves a solid roof above the landing.
  for (let along = 1; along <= 16; along += 1) {
    const px = x + along;
    const pz = landingZ - Math.floor(along * 0.35);
    if (!writer.inside(px, pz)) break;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let y = landingY; y <= landingY + 3; y += 1) {
          const index = chunkIndex(px + dx - writer.startX, y, pz + dz - writer.startZ);
          if (CARVEABLE.has(writer.blocks[index])) writer.blocks[index] = 0;
        }
      }
    }
    if (hash2(px, pz, seed + 9067) < 0.18) {
      writer.set(px, landingY, pz, ID.cave_moss);
    }
    if (along === 9 || along === 15) {
      writer.set(px, landingY + 1, pz, ID.glow_crystal);
    }
  }

  // Rim stones make the stair legible from the surface without closing it.
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      if (Math.abs(dx) < 2 && dz === 0) continue;
      writer.set(x + dx, ground + 1, z + dz, ID.cobblestone);
    }
  }
  writer.set(x, ground - 1, z, ID.cave_moss);
  writer.set(x + 1, landingY + 1, landingZ - 1, ID.glow_crystal);
  writer.set(x - 1, landingY + 1, landingZ - 1, ID.mushroom);
}

export function carveCaves(writer: ChunkWriter, terrain: Terrain, seed: number): void {
  const entrance = caveEntranceForChunk(terrain, writer.chunk.cx, writer.chunk.cz);
  if (entrance) carveEntrance(writer, entrance, seed);

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
        if (!CARVEABLE.has(writer.blocks[index])) continue;
        writer.blocks[index] = 0;

        // The block below is the cave floor. Dress it sparsely, never in the
        // walking space, so every decoration is both visible and traversable.
        const floor = writer.get(x, y - 1, z);
        if (!CARVEABLE.has(floor) || writer.get(x, y + 1, z) !== 0) continue;
        const roll = hash2(x * 3 + y, z * 5 - y, seed + 9079);
        if (roll < 0.035) {
          writer.set(x, y - 1, z, ID.cave_moss);
        } else if (roll < 0.06 && chamber) {
          writer.set(x, y, z, ID.mushroom);
        } else if (roll > 0.9965 && chamber) {
          // A small crystal cluster: the floor-mounted block plus a wall gem.
          writer.set(x, y, z, ID.glow_crystal);
          const wallX = x + (hash2(x, z, seed + 9091) > 0.5 ? 1 : -1);
          if (writer.inside(wallX, z) && writer.get(wallX, y, z) !== 0) {
            writer.set(x, y + 1, z, ID.glow_crystal);
          }
        }
      }
    }
  }
}

/** True when a surface cell belongs to a generated entrance ramp. */
export function isCaveEntranceSurface(
  terrain: Terrain,
  chunkX: number,
  chunkZ: number,
  x: number,
  z: number,
): boolean {
  const entrance = caveEntranceForChunk(terrain, chunkX, chunkZ);
  return entrance !== null && isEntranceFootprint(entrance, x, z);
}

export const caveStage: ChunkStage = Object.freeze({
  id: "caves",
  order: 25,
  run: ({ writer, terrain, seed }: GenerationContext) => carveCaves(writer, terrain, seed),
});
