import { ID } from "./blocks";
import { CHUNK_SIZE, ChunkWriter, SEA_LEVEL } from "./chunk";
import { hash2 } from "./noise";
import type { Column, Terrain } from "./terrain";

/**
 * Vegetation is placed on a jittered grid: each 7 x 7 cell may hold at most one
 * plant, whose position and species are pure functions of the cell. That makes
 * spacing natural, keeps canopies from piling up, and lets every chunk stamp
 * the part of a tree that falls inside it without asking its neighbours.
 *
 * Species follow the biome:
 *   forest  - oak, birch (and spruce where it is cool)
 *   plains  - rare lone oaks and shrubs
 *   taiga   - spruce
 *   tundra  - sparse stunted spruce
 *   swamp   - broad low oaks
 *   desert  - cactus
 *   mountain slopes - spruce, thinning out with height
 */

const CELL = 7;
const MARGIN = 9;

type Species = "oak" | "birch" | "spruce" | "cactus" | "shrub" | "swamp_oak";

function pickSpecies(column: Column, x: number, z: number, seed: number): Species | null {
  const roll = hash2(x, z, seed + 2807);
  const pick = hash2(x, z, seed + 2809);
  const top = column.top;
  const growsOnSoil =
    top === ID.grass || top === ID.moss || top === ID.mud || top === ID.snow || top === ID.dirt;

  switch (column.biome) {
    case "forest":
      if (!growsOnSoil || roll > 0.82) return null;
      if (column.temperature < 0.45 && pick > 0.5) return "spruce";
      return pick < 0.3 ? "birch" : "oak";
    case "plains":
      if (!growsOnSoil) return null;
      if (roll < 0.05) return "oak";
      if (roll < 0.14) return "shrub";
      return null;
    case "taiga":
      return growsOnSoil && roll < 0.7 ? "spruce" : null;
    case "tundra":
      return growsOnSoil && roll < 0.06 ? "spruce" : null;
    case "swamp":
      return growsOnSoil && roll < 0.4 ? "swamp_oak" : null;
    case "desert":
      return top === ID.sand && roll < 0.07 ? "cactus" : null;
    case "mountain": {
      if (top !== ID.grass && top !== ID.snow && top !== ID.moss) return null;
      const limit = 0.3 * Math.max(0, 1 - (column.ground - SEA_LEVEL - 20) / 80);
      return roll < limit ? "spruce" : null;
    }
    default:
      return null;
  }
}

export function leafBlob(
  writer: ChunkWriter,
  cx: number,
  cy: number,
  cz: number,
  radiusXZ: number,
  radiusY: number,
  leaf: number,
  seed: number,
  holes: number,
): void {
  const reach = Math.ceil(radiusXZ);
  const reachY = Math.ceil(radiusY);
  for (let dx = -reach; dx <= reach; dx += 1) {
    for (let dz = -reach; dz <= reach; dz += 1) {
      if (!writer.overlaps(cx + dx, cz + dz, cx + dx, cz + dz)) continue;
      for (let dy = -reachY; dy <= reachY; dy += 1) {
        const d =
          (dx * dx + dz * dz) / (radiusXZ * radiusXZ) + (dy * dy) / (radiusY * radiusY);
        if (d > 1) continue;
        // A few gaps near the edge make the crown look like foliage, not a ball.
        if (d > 0.62 && hash2(cx + dx * 7 + dy * 3, cz + dz * 5 - dy, seed + 2851) < holes) continue;
        writer.setIfAir(cx + dx, cy + dy, cz + dz, leaf);
      }
    }
  }
}

function stampOak(writer: ChunkWriter, x: number, y0: number, z: number, seed: number, swamp: boolean): void {
  const size = hash2(x, z, seed + 3791);
  const trunk = swamp ? 8 + Math.floor(size * 4) : 11 + Math.floor(size * 7);
  const radius = swamp ? 5.4 : 4 + (size > 0.6 ? 1 : 0.4);
  for (let y = y0 + 1; y <= y0 + trunk; y += 1) writer.set(x, y, z, ID.wood);
  // Root flare and a couple of limbs for a less pole-like trunk.
  if (!swamp) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (hash2(x + dx, z + dz, seed + 3811) > 0.45) writer.set(x + dx, y0 + 1, z + dz, ID.wood);
    }
  }
  const limbY = y0 + Math.floor(trunk * 0.62);
  const dir = Math.floor(hash2(x, z, seed + 3821) * 4);
  const [lx, lz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][dir];
  writer.set(x + lx, limbY, z + lz, ID.wood);
  writer.set(x + lx * 2, limbY + 1, z + lz * 2, ID.wood);
  leafBlob(writer, x, y0 + trunk - 1, z, radius, swamp ? 2.8 : 3.6, ID.leaves, seed, 0.14);
  leafBlob(writer, x + lx * 3, limbY + 2, z + lz * 3, 2.4, 2, ID.leaves, seed + 5, 0.14);
}

function stampBirch(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const size = hash2(x, z, seed + 3793);
  const trunk = 13 + Math.floor(size * 7);
  for (let y = y0 + 1; y <= y0 + trunk; y += 1) writer.set(x, y, z, ID.birch_wood);
  leafBlob(writer, x, y0 + trunk - 2, z, 3.1, 4.6, ID.birch_leaves, seed, 0.12);
}

function stampSpruce(writer: ChunkWriter, x: number, y0: number, z: number, seed: number, small: boolean): void {
  const size = hash2(x, z, seed + 3797);
  const trunk = small ? 9 + Math.floor(size * 4) : 15 + Math.floor(size * 10);
  const top = y0 + trunk;
  const maxRadius = small ? 2 : trunk >= 19 ? 4 : 3;
  for (let y = y0 + 1; y <= top; y += 1) writer.set(x, y, z, ID.spruce_wood);
  const start = y0 + (small ? 3 : 4);
  const height = top + 2 - start;
  for (let y = start; y <= top + 2; y += 1) {
    const layer = y - start;
    let radius = Math.round((maxRadius * (top + 2 - y)) / height);
    // Tiered branches: every third layer steps in, like a real spruce.
    if (layer % 3 === 0 && radius > 1) radius -= 1;
    if (radius <= 0 && y < top + 2) radius = 1;
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (dx * dx + dz * dz > radius * radius + (radius > 2 ? 1 : 0)) continue;
        if (dx === 0 && dz === 0 && y <= top) continue;
        writer.setIfAir(x + dx, y, z + dz, ID.spruce_leaves);
      }
    }
  }
}

function stampCactus(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const height = 4 + Math.floor(hash2(x, z, seed + 3803) * 5);
  for (let y = y0 + 1; y <= y0 + height; y += 1) writer.set(x, y, z, ID.cactus);
  if (hash2(x, z, seed + 3805) > 0.45) {
    const dir = Math.floor(hash2(x, z, seed + 3807) * 4);
    const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][dir];
    const armY = y0 + Math.floor(height * 0.5);
    writer.set(x + dx, armY, z + dz, ID.cactus);
    writer.set(x + dx * 2, armY, z + dz * 2, ID.cactus);
    for (let rise = 1; rise <= 2; rise += 1) writer.set(x + dx * 2, armY + rise, z + dz * 2, ID.cactus);
  }
}

function stampShrub(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  writer.set(x, y0 + 1, z, ID.wood);
  leafBlob(writer, x, y0 + 2, z, 1.9, 1.5, ID.leaves, seed, 0.1);
}

export function placeVegetation(writer: ChunkWriter, terrain: Terrain, seed: number): void {
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
      if (column.water > column.ground || column.flat > 0) continue;
      const species = pickSpecies(column, cellX, cellZ, seed);
      if (!species) continue;
      const y0 = column.ground;
      switch (species) {
        case "oak": stampOak(writer, x, y0, z, seed, false); break;
        case "swamp_oak": stampOak(writer, x, y0, z, seed, true); break;
        case "birch": stampBirch(writer, x, y0, z, seed); break;
        case "spruce": stampSpruce(writer, x, y0, z, seed, column.biome === "tundra"); break;
        case "cactus": stampCactus(writer, x, y0, z, seed); break;
        case "shrub": stampShrub(writer, x, y0, z, seed); break;
      }
    }
  }
}

/** Wildflowers dot meadows and clearings, never beaches, rock or snow. */
export function hasFlower(column: Column, x: number, z: number, seed: number): boolean {
  if (column.top !== ID.grass || column.flat > 0) return false;
  const roll = hash2(x, z, seed + 819);
  if (column.biome === "plains") return roll > 0.955;
  if (column.biome === "forest") return roll > 0.985;
  if (column.biome === "taiga") return roll > 0.992;
  return false;
}
