/**
 * Ground cover: small plants that are part of the world but are cleared rather
 * than collected (ferns, meadow grass, reeds, mushrooms).
 *
 * Placement is a pure function of local terrain — biome, moisture, fertility,
 * sunlight, slope and patch noise — so it stays consistent across streamed
 * chunk boundaries and never uses hand-authored coordinates. This module is a
 * single ordered set of ecological niches; adding a cover species means adding
 * a niche rule, not editing the chunk generator.
 */
import { ID } from "../blocks";
import { MAX_BUILD_HEIGHT } from "../chunk";
import { hash2, valueNoise } from "../noise";
import type { Biome, Column } from "../terrain";

const WETLAND_BIOMES: readonly Biome[] = ["swamp", "marsh", "wetland", "peat_bog", "bioluminescent_wetland"];
const JUNGLE_BIOMES: readonly Biome[] = ["rainforest", "tropical_rainforest", "fungal", "fungal_forest", "ancient_forest"];
const SHADED_FOREST_BIOMES: readonly Biome[] = ["forest", "ancient_forest", "fungal_forest", "swamp", "marsh", "wetland"];
const MEADOW_BIOMES: readonly Biome[] = ["plains", "savanna"];
const COLD_BIOMES: readonly Biome[] = ["taiga", "boreal_forest", "alpine", "alpine_meadow", "alpine_forest"];

/** Deterministic ground cover from climate, terrain and soil. */
export function groundCoverType(column: Column, x: number, z: number, seed: number): number | null {
  if (column.water > column.ground || column.ground >= MAX_BUILD_HEIGHT - 2 || column.slope >= 3) return null;
  const roll = hash2(x, z, seed + 8311);
  const patch = valueNoise(x + 31, z - 67, 17, seed + 8317);
  const wet = column.moisture;
  const fertility = column.soilFertility;
  const nearWater = column.biome === "river" || column.riverDist < column.riverHalfWidth + 3;
  if ((WETLAND_BIOMES.includes(column.biome) || nearWater) &&
      wet > 0.54 && roll < 0.12 + patch * 0.14) return ID.reed;
  if (JUNGLE_BIOMES.includes(column.biome) &&
      wet > 0.62 && roll < 0.24 + patch * 0.18) return roll < 0.11 + patch * 0.08 ? ID.mushroom : ID.fern;
  if (SHADED_FOREST_BIOMES.includes(column.biome) &&
      wet > 0.53 && column.sunlight < 0.78 && roll < 0.14 + fertility * 0.12 + patch * 0.12)
    return roll < 0.045 + patch * 0.06 ? ID.mushroom : ID.fern;
  if (MEADOW_BIOMES.includes(column.biome) && column.top === ID.grass &&
      patch > 0.42 && roll < 0.06 + fertility * 0.13) return ID.tall_grass;
  if (COLD_BIOMES.includes(column.biome) &&
      wet > 0.52 && fertility > 0.34 && patch > 0.68 && roll < 0.12) return ID.fern;
  return null;
}
