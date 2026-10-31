/**
 * Terrain vocabulary shared by the height model, the climate model, the
 * surface classifier and the cached `Terrain` facade.
 */

export type Biome =
  | "ocean"
  | "river"
  | "beach"
  | "desert"
  | "badlands"
  | "plains"
  | "grassland"
  | "savanna"
  | "forest"
  | "rainforest"
  | "tropical_rainforest"
  | "ancient_forest"
  | "taiga"
  | "boreal_forest"
  | "tundra"
  | "alpine"
  | "alpine_meadow"
  | "alpine_forest"
  | "swamp"
  | "marsh"
  | "peat_bog"
  | "wetland"
  | "mountain"
  | "volcanic"
  | "coastal"
  | "mangrove"
  | "fungal"
  | "fungal_forest"
  | "bioluminescent_wetland"
  | "crystal_valley";

export interface HeightRecord {
  /** y of the top solid block. */
  ground: number;
  /** y of the water surface in this column, or 0 if dry. */
  water: number;
  /** Blocks to the nearest river centre line (Infinity when far from any river). */
  riverDist: number;
  riverHalfWidth: number;
  /** Smoothed elevation without fine relief. */
  broad: number;
  mountain: number;
}

export interface EnvironmentalData {
  elevation: number;
  slope: number;
  soilDepth: number;
  moisture: number;
  temperature: number;
  rainfall: number;
  windExposure: number;
  sunlight: number;
  geologicalComposition: string;
}

export interface Column extends HeightRecord, EnvironmentalData {
  biome: Biome;
  /** Block id of the surface. */
  top: number;
  /** Block id of the soil under it, and how many blocks deep. */
  soil: number;
  /** Optional sedimentary band under the soil (sandstone under desert sand). */
  mid: number;
  midDepth: number;
  /** Bedrock-type for everything below. */
  rock: number;
  frozen: boolean;
  soilFertility: number;
  soilComposition: "organic" | "loam" | "clay" | "sand" | "rock";
}
