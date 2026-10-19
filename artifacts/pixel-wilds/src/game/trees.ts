import { ID } from "./blocks";
import { CHUNK_SIZE, ChunkWriter, MAX_BUILD_HEIGHT, SEA_LEVEL } from "./chunk";
import { clamp01, hash2, valueNoise } from "./noise";
import type { Column, Terrain } from "./terrain";

/**
 * Vegetation is placed on a jittered grid: each 7 x 7 cell may hold at most one
 * plant, whose position and species are pure functions of the cell. That makes
 * spacing natural, keeps canopies from piling up, and lets every chunk stamp
 * the part of a tree that falls inside it without asking its neighbours.
 *
 * Species follow the biome, and a slow "stand" noise makes neighbouring
 * woods lean different ways, so you get whole birch groves, redwood stands
 * and pine belt rather than an even mix everywhere:
 *   forest  - oak, birch or pine belts, rare giant redwoods, spruce when cool
 *   plains  - rare lone oaks and shrubs
 *   taiga   - spruce, with taller pine stands
 *   tundra  - sparse stunted spruce
 *   swamp   - willows and broad low oaks
 *   desert  - cactus
 *   beach   - leaning palms
 *   mountain slopes - spruce, thinning out with height
 *
 * Trunk sizes (blocks; 1 block = 0.5 m), from shortest to longest:
 *   shrub 1 · cactus 4-8 · swamp oak 8-11 · oak 11-17 · willow 9-13,
 *   birch 13-19 · palm 12-20 · pine 18-29 · spruce 15-24 · redwood 44-63
 * Redwoods are also the only trunk with a 3 x 3 base.
 */

const CELL = 6;
const MARGIN = 9;

type Species =
  | "oak"
  | "birch"
  | "spruce"
  | "pine"
  | "redwood"
  | "palm"
  | "willow"
  | "cactus"
  | "shrub"
  | "tall_shrub"
  | "fern"
  | "moss"
  | "grass"
  | "flower_patch"
  | "swamp_oak"
  | "tropical"
  | "baobab";

function pickSpecies(column: Column, x: number, z: number, seed: number): Species | null {
  const roll = hash2(x, z, seed + 2807);
  const groveDensity = valueNoise(x - 27, z + 13, 38, seed + 2821);
  const exposure = valueNoise(x + 71, z - 41, 17, seed + 2823);
  const pick = hash2(x, z, seed + 2809);
  // Which wood dominates this patch of country (0 = birch grove, 1 = conifers).
  const stand = valueNoise(x, z, 14, seed + 2813);
  const top = column.top;
  const growsOnSoil =
    top === ID.grass || top === ID.moss || top === ID.mud || top === ID.snow || top === ID.dirt || top === ID.thatch;

  const growthSuitability = clamp01(0.88 + column.soilFertility * 0.17 + column.moisture * 0.1 - column.windExposure * 0.11 - column.slope * 0.02);

  switch (column.biome) {
    case "tropical_rainforest":
    case "rainforest":
      if (!growsOnSoil || roll > 0.95) return null;
      if (stand > 0.78 && pick < 0.24) return "redwood";
      return pick < 0.72 ? "tropical" : "oak";
    case "fungal":
    case "fungal_forest":
      if (!growsOnSoil || roll > (0.48 + groveDensity * 0.32) * growthSuitability) return null;
      return pick < 0.36 ? "tropical" : pick < 0.68 ? "willow" : "oak";
    case "ancient_forest":
      if (!growsOnSoil || roll > 0.95) return null;
      if (roll < 0.4) return "redwood";
      if (pick < 0.3) return "oak";
      return "oak";
    case "forest":
      if (!growsOnSoil || roll > 0.48 + groveDensity * 0.43 || (exposure < 0.22 && roll > 0.24)) return null;
      if (column.temperature < 0.45 && pick > 0.5) return "spruce";
      if (stand < 0.3) return pick < 0.25 ? "oak" : "birch";
      if (stand > 0.74) return pick < 0.3 ? "redwood" : pick < 0.62 ? "pine" : "oak";
      if (pick < 0.28) return "pine";
      if (pick < 0.45) return "birch";
      return "oak";
    case "beach":
    case "coastal":
    case "mangrove":
      return top === ID.sand && roll < 0.35 ? "palm" : null;
    case "plains":
    case "grassland":
      if (!growsOnSoil) return null;
      if (roll < 0.08) return "oak";
      if (roll < 0.18) return "shrub";
      return null;
    case "savanna":
      if (!growsOnSoil || roll > 0.2 * growthSuitability) return null;
      return pick < 0.24 ? "baobab" : pick < 0.65 ? "oak" : "shrub";
    case "taiga":

    case "boreal_forest":
      if (!growsOnSoil || roll >= 0.75) return null;

      return stand > 0.62 && pick < 0.7 ? "pine" : "spruce";
    case "tundra":
    case "alpine_meadow":
      return growsOnSoil && roll < 0.08 ? "spruce" : null;
    case "alpine":
    case "alpine_forest":
      if (!growsOnSoil || roll >= 0.6) return null;
      return "spruce";
    case "swamp":

    case "marsh":
    case "wetland":
    case "peat_bog":
    case "bioluminescent_wetland":
      if (!growsOnSoil || roll >= 0.5) return null;

      return pick < 0.4 ? "willow" : "swamp_oak";
    case "desert":
    case "badlands":
      return top === ID.sand && roll < 0.1 ? "cactus" : null;
    case "volcanic":
      return null;
    case "mountain": {
      if (top !== ID.grass && top !== ID.snow && top !== ID.moss) return null;
      const limit = 0.4 * Math.max(0, 1 - (column.ground - SEA_LEVEL - 20) / 100);
      return roll < limit ? "spruce" : null;
    }
    case "crystal_valley":
      return growsOnSoil && roll < 0.15 ? "oak" : null;
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
  const trunk = Math.min(MAX_BUILD_HEIGHT - y0 - 7, swamp ? 9 + Math.floor(size * 4) : 13 + Math.floor(size * 8));

  const radius = swamp ? 5.4 + size * 1.1 : 3.4 + size * 2.2;
  for (let y = y0 + 1; y <= y0 + trunk; y += 1) writer.set(x, y, z, ID.wood);
  // Irregular root flare and buttress roots make trunks feel anchored in soil.
  if (!swamp) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const chance = hash2(x + dx * 3, z + dz * 5, seed + 3811);
      if (chance > 0.34) writer.set(x + dx, y0 + 1, z + dz, ID.wood);
      if (Math.abs(dx) + Math.abs(dz) === 1 && chance > 0.62) writer.set(x + dx * 2, y0 + 1, z + dz * 2, ID.wood);
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
  const trunk = Math.min(MAX_BUILD_HEIGHT - y0 - 7, 16 + Math.floor(size * 8));
  for (let y = y0 + 1; y <= y0 + trunk; y += 1) writer.set(x, y, z, ID.birch_wood);
  leafBlob(writer, x, y0 + trunk - 2, z, 3.1, 4.6, ID.birch_leaves, seed, 0.12);
}

function stampSpruce(writer: ChunkWriter, x: number, y0: number, z: number, seed: number, small: boolean): void {
  const size = hash2(x, z, seed + 3797);
  const trunk = Math.min(MAX_BUILD_HEIGHT - y0 - 3, small ? 10 + Math.floor(size * 4) : 18 + Math.floor(size * 11));
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

function stampPine(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const size = hash2(x, z, seed + 3821);
  const trunk = Math.min(MAX_BUILD_HEIGHT - y0 - 3, 22 + Math.floor(size * 13));
  const top = y0 + trunk;
  for (let y = y0 + 1; y <= top; y += 1) writer.set(x, y, z, ID.spruce_wood);
  // Narrow and bare-bottomed: foliage only starts a third of the way up,
  // in alternating whorls, so the long trunk stays the point of a pine.
  const start = y0 + Math.floor(trunk / 3);
  const maxRadius = trunk >= 26 ? 3 : 2;
  const height = top + 2 - start;
  for (let y = start; y <= top + 2; y += 1) {
    const layer = y - start;
    let radius = Math.round((maxRadius * (top + 2 - y)) / height);
    if (layer % 2 === 1 && radius > 1) radius -= 1;
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

/**
 * The giant of the woods: 22-31 m of trunk with a 3 x 3 buttressed base that
 * tapers to a single column, and a crown held high above the canopy.
 */
function stampRedwood(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const size = hash2(x, z, seed + 3811);


  const trunk = 60 + Math.floor(size * 40);
  const baseHeight = 12 + Math.floor(size * 8);

  for (let y = y0 + 1; y <= y0 + trunk; y += 1) {
    const radius = y <= y0 + baseHeight ? 1 : 0;
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        writer.set(x + dx, y, z + dz, ID.wood);
      }
    }
  }
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
    if (hash2(x + dx, z + dz, seed + 3813) > 0.35) writer.set(x + dx, y0 + 1, z + dz, ID.wood);
  }
  const limbDir = Math.floor(hash2(x, z, seed + 3817) * 4);
  const [lx, lz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][limbDir];
  writer.set(x + lx * 2, y0 + Math.floor(trunk * 0.72), z + lz * 2, ID.wood);
  leafBlob(writer, x, y0 + trunk - 5, z, 5.2, 5.6, ID.leaves, seed, 0.16);
  leafBlob(writer, x, y0 + trunk + 1, z, 3.4, 2.6, ID.leaves, seed + 3, 0.14);
}

/** A coastal palm: a thin trunk that leans storey by storey under a frond crown. */
function stampPalm(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const size = hash2(x, z, seed + 3823);
  const trunk = Math.min(MAX_BUILD_HEIGHT - y0 - 5, 14 + Math.floor(size * 9));
  const dir = Math.floor(hash2(x, z, seed + 3825) * 4);
  const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][dir];
  let lean = 0;
  for (let y = y0 + 1; y <= y0 + trunk; y += 1) {
    lean = Math.floor(((y - y0) * 3) / trunk);
    writer.set(x + dx * lean, y, z + dz * lean, ID.wood);
  }
  const topX = x + dx * lean;
  const topZ = z + dz * lean;
  const topY = y0 + trunk;
  leafBlob(writer, topX, topY + 1, topZ, 3.4, 1.5, ID.leaves, seed, 0.1);
  for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    leafBlob(writer, topX + fx * 3, topY, topZ + fz * 3, 1.9, 1, ID.leaves, seed + 7, 0.12);
  }
  writer.set(topX, topY + 2, topZ, ID.leaves);
}

/** A swamp willow: squat, wide, with curtains of foliage hanging to the ground. */
function stampWillow(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const size = hash2(x, z, seed + 3827);
  const trunk = Math.min(MAX_BUILD_HEIGHT - y0 - 6, 11 + Math.floor(size * 6));
  const radius = 5.4 + (size > 0.6 ? 1.4 : 0);
  for (let y = y0 + 1; y <= y0 + trunk; y += 1) writer.set(x, y, z, ID.wood);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (hash2(x + dx, z + dz, seed + 3829) > 0.4) {
      writer.set(x + dx, y0 + trunk - 1, z + dz, ID.wood);
      writer.set(x + dx * 2, y0 + trunk - 2, z + dz * 2, ID.wood);
    }
  }
  leafBlob(writer, x, y0 + trunk + 1, z, radius, 3.4, ID.leaves, seed, 0.12);
  const reach = Math.ceil(radius);
  for (let dx = -reach; dx <= reach; dx += 1) {
    for (let dz = -reach; dz <= reach; dz += 1) {
      const dist = Math.hypot(dx, dz);
      if (dist < radius - 1.4 || dist > radius + 0.6) continue;
      if (hash2(x + dx, z + dz, seed + 3833) < 0.45) continue;
      const drop = 2 + Math.floor(hash2(x + dx * 3, z + dz * 3, seed + 3839) * 5);
      for (let d = 1; d <= drop; d += 1) {
        writer.setIfAir(x + dx, y0 + trunk + 1 - d, z + dz, ID.leaves);
      }
    }
  }
}

/** Seeded rainforest tree with a flared trunk, tiered canopy and hanging vines. */
function stampTropical(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const size = hash2(x, z, seed + 3851);
  const trunk = Math.max(1, Math.min(MAX_BUILD_HEIGHT - y0 - 12, 24 + Math.floor(size * 16)));
  for (let y = y0 + 1; y <= y0 + trunk; y += 1) {
    const radius = y <= y0 + 5 && size > 0.35 ? 1 : 0;
    for (let dx = -radius; dx <= radius; dx += 1)
      for (let dz = -radius; dz <= radius; dz += 1) writer.set(x + dx, y, z + dz, ID.wood);
  }
  const crownY = y0 + trunk - 2;
  leafBlob(writer, x, crownY, z, 6.4 + size * 1.4, 4.4, ID.leaves, seed + 17, 0.2);
  for (let branch = 0; branch < 4; branch += 1) {
    const angle = branch * Math.PI / 2 + size;
    const dx = Math.round(Math.cos(angle) * (3 + size * 2));
    const dz = Math.round(Math.sin(angle) * (3 + size * 2));
    leafBlob(writer, x + dx, crownY - 3, z + dz, 3.4, 2.6, ID.leaves, seed + branch, 0.17);
    for (let drop = 0; drop < 5; drop += 1)
      writer.setIfAir(x + dx, crownY - 5 - drop, z + dz, ID.vine);
  }
}

/** Broad-canopied savanna tree with a thick, variable trunk. */
function stampBaobab(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const size = hash2(x, z, seed + 3861);
  const trunk = Math.max(1, Math.min(MAX_BUILD_HEIGHT - y0 - 7, 13 + Math.floor(size * 8)));
  for (let y = y0 + 1; y <= y0 + trunk; y += 1) {
    const radius = y <= y0 + 6 && size > 0.25 ? 1 : 0;
    for (let dx = -radius; dx <= radius; dx += 1)
      for (let dz = -radius; dz <= radius; dz += 1) writer.set(x + dx, y, z + dz, ID.wood);
  }
  leafBlob(writer, x, y0 + trunk, z, 5.8 + size * 1.2, 3.2, ID.leaves, seed + 23, 0.22);
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
      const species = pickSpecies(column, cellX, cellZ, seed);
      if (!species) continue;
      const y0 = column.ground;
      switch (species) {
        case "oak": stampOak(writer, x, y0, z, seed, false); break;
        case "swamp_oak": stampOak(writer, x, y0, z, seed, true); break;
        case "birch": stampBirch(writer, x, y0, z, seed); break;
        case "spruce": stampSpruce(writer, x, y0, z, seed, column.biome === "tundra"); break;
        case "pine": stampPine(writer, x, y0, z, seed); break;
        case "redwood": stampRedwood(writer, x, y0, z, seed); break;
        case "palm": stampPalm(writer, x, y0, z, seed); break;
        case "willow": stampWillow(writer, x, y0, z, seed); break;
        case "cactus": stampCactus(writer, x, y0, z, seed); break;
        case "tropical": stampTropical(writer, x, y0, z, seed); break;
        case "baobab": stampBaobab(writer, x, y0, z, seed); break;
        case "shrub": stampShrub(writer, x, y0, z, seed); break;
        case "tall_shrub": stampTallShrub(writer, x, y0, z, seed); break;
        case "fern": stampFern(writer, x, y0, z, seed); break;
        case "moss": stampMoss(writer, x, y0, z, seed); break;
        case "grass": stampGrass(writer, x, y0, z, seed); break;
        case "flower_patch": stampFlowerPatch(writer, x, y0, z, seed); break;
      }
    }
  }
}

function stampTallShrub(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  writer.set(x, y0 + 1, z, ID.wood);
  leafBlob(writer, x, y0 + 3, z, 2.4, 2.0, ID.leaves, seed, 0.12);
}

function stampFern(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  writer.setIfAir(x, y0 + 1, z, ID.leaves);
  writer.setIfAir(x + 1, y0 + 1, z, ID.leaves);
  writer.setIfAir(x - 1, y0 + 1, z, ID.leaves);
}

function stampMoss(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const r = Math.floor(hash2(x, z, seed + 4101) * 3) + 1;
  for (let i = 0; i < r; i++) {
    const dx = Math.floor(hash2(x + i, z, seed + 4103) * 3) - 1;
    const dz = Math.floor(hash2(x, z + i, seed + 4105) * 3) - 1;
    writer.setIfAir(x + dx, y0 + 1, z + dz, ID.leaves);
  }
}

function stampGrass(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const r = Math.floor(hash2(x, z, seed + 4111) * 4) + 2;
  for (let i = 0; i < r; i++) {
    const dx = Math.floor(hash2(x + i, z, seed + 4113) * 5) - 2;
    const dz = Math.floor(hash2(x, z + i, seed + 4115) * 5) - 2;
    writer.setIfAir(x + dx, y0 + 1, z + dz, ID.leaves);
  }
}

function stampFlowerPatch(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const r = Math.floor(hash2(x, z, seed + 4121) * 2) + 1;
  for (let i = 0; i < r; i++) {
    const dx = Math.floor(hash2(x + i, z, seed + 4123) * 3) - 1;
    const dz = Math.floor(hash2(x, z + i, seed + 4125) * 3) - 1;
    writer.setIfAir(x + dx, y0 + 1, z + dz, ID.flower);
  }
}

/** Wildflowers dot meadows and clearings, never beaches, rock or snow. */
export function hasFlower(column: Column, x: number, z: number, seed: number): boolean {
  if (column.top !== ID.grass) return false;
  const roll = hash2(x, z, seed + 819);
  const moisture = column.moisture;
  if (column.biome === "savanna") return roll > 0.955;
  if (column.biome === "plains" || column.biome === "grassland") return roll > 0.92;
  if (column.biome === "forest" || column.biome === "rainforest" || column.biome === "tropical_rainforest") return roll > 0.97;
  if (column.biome === "taiga" || column.biome === "boreal_forest" || column.biome === "alpine_meadow") return roll > 0.985;
  if (column.biome === "ancient_forest" || column.biome === "fungal_forest" || column.biome === "fungal") return roll > 0.96;
  if (moisture > 0.6) return roll > 0.95;
  return false;
}

/** Deterministic ground cover from climate, terrain and soil. */
export function groundCoverType(column: Column, x: number, z: number, seed: number): number | null {
  if (column.water > column.ground || column.ground >= MAX_BUILD_HEIGHT - 2 || column.slope >= 3) return null;
  const roll = hash2(x, z, seed + 8311);
  const patch = valueNoise(x + 31, z - 67, 17, seed + 8317);
  const wet = column.moisture;
  const fertility = column.soilFertility;
  const nearWater = column.biome === "river" || column.riverDist < column.riverHalfWidth + 3;
  if ((["swamp", "marsh", "wetland", "peat_bog", "bioluminescent_wetland"].includes(column.biome) || nearWater) &&
      wet > 0.54 && roll < 0.12 + patch * 0.14) return ID.reed;
  if (["rainforest", "tropical_rainforest", "fungal", "fungal_forest", "ancient_forest"].includes(column.biome) &&
      wet > 0.62 && roll < 0.24 + patch * 0.18) return roll < 0.11 + patch * 0.08 ? ID.mushroom : ID.fern;
  if (["forest", "ancient_forest", "fungal_forest", "swamp", "marsh", "wetland"].includes(column.biome) &&
      wet > 0.53 && column.sunlight < 0.78 && roll < 0.14 + fertility * 0.12 + patch * 0.12)
    return roll < 0.045 + patch * 0.06 ? ID.mushroom : ID.fern;
  if (["plains", "savanna"].includes(column.biome) && column.top === ID.grass &&
      patch > 0.42 && roll < 0.06 + fertility * 0.13) return ID.tall_grass;
  if (["taiga", "boreal_forest", "alpine", "alpine_meadow", "alpine_forest"].includes(column.biome) &&
      wet > 0.52 && fertility > 0.34 && patch > 0.68 && roll < 0.12) return ID.fern;
  return null;
}
