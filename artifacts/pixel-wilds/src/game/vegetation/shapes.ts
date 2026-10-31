import type { ChunkWriter } from "../chunk";
import { hash2 } from "../noise";

/**
 * Reusable sculpting primitives shared by every vegetation species.
 * Kept free of terrain and biome knowledge so a species can compose them
 * without importing the placement system.
 */

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

/** A cylindrical canopy layer, used by conifer whorls. */
export function foliageDisc(
  writer: ChunkWriter,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  leaf: number,
  skipCentre: boolean,
): void {
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      if (dx * dx + dz * dz > radius * radius + (radius > 2 ? 1 : 0)) continue;
      if (skipCentre && dx === 0 && dz === 0) continue;
      writer.setIfAir(cx + dx, cy, cz + dz, leaf);
    }
  }
}
