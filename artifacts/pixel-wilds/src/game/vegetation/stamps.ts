import { ID } from "../blocks";
import { MAX_BUILD_HEIGHT, type ChunkWriter } from "../chunk";
import { hash2 } from "../noise";
import { foliageDisc, leafBlob } from "./shapes";

/**
 * Species shapes: pure sculpting, one function per plant form.
 *
 * These know nothing about biomes or where a tree is allowed to grow — that is
 * the species registry's job. Each shape is portable, so a new species can
 * reuse an existing trunk and crown with different parameters.
 *
 * Trunk sizes (blocks; 1 block = 0.5 m), from shortest to longest:
 *   shrub 1 · cactus 4-8 · swamp oak 8-11 · oak 11-17 · willow 9-13,
 *   birch 13-19 · palm 12-20 · pine 18-29 · spruce 15-24 · redwood 44-63
 * Redwoods are the only trunk with a 3 x 3 base.
 */

export function stampOak(
  writer: ChunkWriter,
  x: number,
  y0: number,
  z: number,
  seed: number,
  swamp = false,
): void {
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

export function stampBirch(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const size = hash2(x, z, seed + 3793);
  const trunk = Math.min(MAX_BUILD_HEIGHT - y0 - 7, 16 + Math.floor(size * 8));
  for (let y = y0 + 1; y <= y0 + trunk; y += 1) writer.set(x, y, z, ID.birch_wood);
  leafBlob(writer, x, y0 + trunk - 2, z, 3.1, 4.6, ID.birch_leaves, seed, 0.12);
}

export function stampSpruce(
  writer: ChunkWriter,
  x: number,
  y0: number,
  z: number,
  seed: number,
  small = false,
): void {
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
    foliageDisc(writer, x, y, z, radius, ID.spruce_leaves, y <= top);
  }
}

export function stampPine(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
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
    foliageDisc(writer, x, y, z, radius, ID.spruce_leaves, y <= top);
  }
}

/**
 * The giant of the woods: 22-31 m of trunk with a 3 x 3 buttressed base that
 * tapers to a single column, and a crown held high above the canopy.
 */
export function stampRedwood(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
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
export function stampPalm(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
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
export function stampWillow(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
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
export function stampTropical(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
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
export function stampBaobab(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const size = hash2(x, z, seed + 3861);
  const trunk = Math.max(1, Math.min(MAX_BUILD_HEIGHT - y0 - 7, 13 + Math.floor(size * 8)));
  for (let y = y0 + 1; y <= y0 + trunk; y += 1) {
    const radius = y <= y0 + 6 && size > 0.25 ? 1 : 0;
    for (let dx = -radius; dx <= radius; dx += 1)
      for (let dz = -radius; dz <= radius; dz += 1) writer.set(x + dx, y, z + dz, ID.wood);
  }
  leafBlob(writer, x, y0 + trunk, z, 5.8 + size * 1.2, 3.2, ID.leaves, seed + 23, 0.22);
}

export function stampCactus(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
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

export function stampShrub(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  writer.set(x, y0 + 1, z, ID.wood);
  leafBlob(writer, x, y0 + 2, z, 1.9, 1.5, ID.leaves, seed, 0.1);
}

/* ------------------------------------------------------------------ */
/* Ground-cover shapes.                                                */
/* Not registered as species today; kept as reusable prototypes so a   */
/* future habitat can adopt them without rewriting the sculpting code. */
/* ------------------------------------------------------------------ */

export function stampTallShrub(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  writer.set(x, y0 + 1, z, ID.wood);
  leafBlob(writer, x, y0 + 3, z, 2.4, 2.0, ID.leaves, seed, 0.12);
}

export function stampFern(writer: ChunkWriter, x: number, y0: number, z: number): void {
  writer.setIfAir(x, y0 + 1, z, ID.leaves);
  writer.setIfAir(x + 1, y0 + 1, z, ID.leaves);
  writer.setIfAir(x - 1, y0 + 1, z, ID.leaves);
}

export function stampMoss(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const r = Math.floor(hash2(x, z, seed + 4101) * 3) + 1;
  for (let i = 0; i < r; i += 1) {
    const dx = Math.floor(hash2(x + i, z, seed + 4103) * 3) - 1;
    const dz = Math.floor(hash2(x, z + i, seed + 4105) * 3) - 1;
    writer.setIfAir(x + dx, y0 + 1, z + dz, ID.leaves);
  }
}

export function stampGrassTuft(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const r = Math.floor(hash2(x, z, seed + 4111) * 4) + 2;
  for (let i = 0; i < r; i += 1) {
    const dx = Math.floor(hash2(x + i, z, seed + 4113) * 5) - 2;
    const dz = Math.floor(hash2(x, z + i, seed + 4115) * 5) - 2;
    writer.setIfAir(x + dx, y0 + 1, z + dz, ID.leaves);
  }
}

export function stampFlowerPatch(writer: ChunkWriter, x: number, y0: number, z: number, seed: number): void {
  const r = Math.floor(hash2(x, z, seed + 4121) * 2) + 1;
  for (let i = 0; i < r; i += 1) {
    const dx = Math.floor(hash2(x + i, z, seed + 4123) * 3) - 1;
    const dz = Math.floor(hash2(x, z + i, seed + 4125) * 3) - 1;
    writer.setIfAir(x + dx, y0 + 1, z + dz, ID.flower);
  }
}
