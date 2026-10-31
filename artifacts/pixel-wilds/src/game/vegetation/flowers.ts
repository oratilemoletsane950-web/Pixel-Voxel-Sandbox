import { ID } from "../blocks";
import { hash2 } from "../noise";
import type { Column } from "../terrain";

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
