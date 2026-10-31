/**
 * Vegetation species registry.
 *
 * Species used to be a union type plus one branch in `pickSpecies` and one
 * case in a dispatch switch in `placeVegetation`: three edits, in three places,
 * for every new tree. Now a species is a single registered definition:
 *
 *   - `habitats` say where it grows (biomes + an acceptance predicate), each
 *     with an explicit priority so overlapping habitats resolve deterministically;
 *   - `stamp` is the sculpting function that builds it.
 *
 * Adding a tree species is one `defineSpecies({...})` entry in this file and no
 * change to the placement loop. Ordering lives in data (priorities), not in the
 * position of a `case` label.
 */
import { ID } from "../blocks";
import { SEA_LEVEL, type ChunkWriter } from "../chunk";
import { Registry } from "../core/registry";
import { prototype } from "../core/prototype";
import { clamp01, hash2, valueNoise } from "../noise";
import type { Biome, Column } from "../terrain";
import {
  stampBaobab,
  stampBirch,
  stampCactus,
  stampOak,
  stampPalm,
  stampPine,
  stampRedwood,
  stampShrub,
  stampSpruce,
  stampTropical,
  stampWillow,
} from "./stamps";

export interface SpeciesRolls {
  /** General presence roll in [0, 1). */
  roll: number;
  /** Species choice roll in [0, 1). */
  pick: number;
  /** Slow stand noise: whole patches lean toward one wood. */
  grove: number;
  exposure: number;
  stand: number;
}

/** The deterministic noise a placement cell contributes to species selection. */
export function speciesRolls(cellX: number, cellZ: number, seed: number): SpeciesRolls {
  return {
    roll: hash2(cellX, cellZ, seed + 2807),
    pick: hash2(cellX, cellZ, seed + 2809),
    grove: valueNoise(cellX - 27, cellZ + 13, 38, seed + 2821),
    exposure: valueNoise(cellX + 71, cellZ - 41, 17, seed + 2823),
    stand: valueNoise(cellX, cellZ, 14, seed + 2813),
  };
}

export interface SpeciesContext extends SpeciesRolls {
  column: Column;
  /** Ecological suitability from soil, moisture, wind and slope. */
  growthSuitability: number;
}

export interface SpeciesHabitat {
  readonly biomes: readonly Biome[];
  /** Lower priority wins when several habitats accept the same cell. */
  readonly priority: number;
  accepts(context: SpeciesContext): boolean;
}

export type SpeciesStamp = (
  writer: ChunkWriter,
  x: number,
  y0: number,
  z: number,
  seed: number,
  column: Column,
) => void;

export interface SpeciesDefinition {
  readonly id: string;
  readonly label: string;
  readonly habitats: readonly SpeciesHabitat[];
  readonly stamp: SpeciesStamp;
}

/** Prototype every species is cloned from; a species only supplies its differences. */
const SPECIES_BASE = prototype<{ habitats: readonly SpeciesHabitat[] }>({ habitats: [] });

export const SPECIES = new Registry<SpeciesDefinition>("vegetation species");

function defineSpecies(definition: SpeciesDefinition): SpeciesDefinition {
  if (definition.habitats.length === 0) {
    throw new Error(`Vegetation species "${definition.id}" declares no habitat`);
  }
  return SPECIES.register(Object.freeze(definition));
}

/** Priority inside one biome. Lower is checked first. */
const FOREST_FIRST = 10;
const FOREST_GROVE = 20;
const FOREST_STAND = 30;
const FOREST_GENERAL = 40;

const WETLANDS: readonly Biome[] = ["swamp", "marsh", "wetland", "peat_bog", "bioluminescent_wetland"];
const JUNGLE: readonly Biome[] = ["rainforest", "tropical_rainforest"];
const FUNGAL: readonly Biome[] = ["fungal", "fungal_forest"];

const SOIL_TOPS: ReadonlySet<number> = new Set([ID.grass, ID.moss, ID.mud, ID.snow, ID.dirt, ID.thatch]);

function growsOnSoil(context: SpeciesContext): boolean {
  return SOIL_TOPS.has(context.column.top);
}

/**
 * The forest gate shared by every forest species: enough light, dense enough
 * stand, and the odd exposed clearing left bare.
 */
function denseForest(context: SpeciesContext): boolean {
  return (
    growsOnSoil(context) &&
    context.roll <= 0.48 + context.grove * 0.43 &&
    !(context.exposure < 0.22 && context.roll > 0.24)
  );
}

function jungle(context: SpeciesContext): boolean {
  return growsOnSoil(context) && context.roll <= 0.95;
}

/** Damp fungal woodland thins out where soil, moisture and shelter are poor. */
function fungalForest(context: SpeciesContext): boolean {
  return (
    growsOnSoil(context) &&
    context.roll <= (0.48 + context.grove * 0.32) * context.growthSuitability
  );
}

function savanna(context: SpeciesContext): boolean {
  return growsOnSoil(context) && context.roll <= 0.2 * context.growthSuitability;
}

function noMountainTreeline(context: SpeciesContext): boolean {
  const top = context.column.top;
  return top === ID.grass || top === ID.snow || top === ID.moss;
}

/* ------------------------------------------------------------------ */
/* Conifers                                                            */
/* ------------------------------------------------------------------ */

defineSpecies({
  ...SPECIES_BASE.extend({
    id: "spruce",
    label: "Spruce",
    habitats: [
      { biomes: ["forest"], priority: FOREST_FIRST, accepts: (c) => denseForest(c) && c.column.temperature < 0.45 && c.pick > 0.5 },
      { biomes: ["taiga", "boreal_forest"], priority: 10, accepts: (c) => growsOnSoil(c) && c.roll < 0.75 && !(c.stand > 0.62 && c.pick < 0.7) },
      { biomes: ["tundra", "alpine_meadow"], priority: 10, accepts: (c) => growsOnSoil(c) && c.roll < 0.08 },
      { biomes: ["alpine", "alpine_forest"], priority: 10, accepts: (c) => growsOnSoil(c) && c.roll < 0.6 },
      {
        biomes: ["mountain"],
        priority: 10,
        accepts: (c) =>
          noMountainTreeline(c) &&
          c.roll < 0.4 * Math.max(0, 1 - (c.column.ground - SEA_LEVEL - 20) / 100),
      },
    ],
    stamp: (writer, x, y0, z, seed, column) => stampSpruce(writer, x, y0, z, seed, column.biome === "tundra"),
  }),
});

defineSpecies({
  ...SPECIES_BASE.extend({
    id: "pine",
    label: "Pine",
    habitats: [
      { biomes: ["forest"], priority: FOREST_STAND, accepts: (c) => denseForest(c) && c.stand > 0.74 && c.pick >= 0.3 && c.pick < 0.62 },
      { biomes: ["forest"], priority: FOREST_GENERAL, accepts: (c) => denseForest(c) && c.pick < 0.28 },
      { biomes: ["taiga", "boreal_forest"], priority: 10, accepts: (c) => growsOnSoil(c) && c.roll < 0.75 && c.stand > 0.62 && c.pick < 0.7 },
    ],
    stamp: (writer, x, y0, z, seed) => stampPine(writer, x, y0, z, seed),
  }),
});

defineSpecies({
  ...SPECIES_BASE.extend({
    id: "redwood",
    label: "Redwood",
    habitats: [
      { biomes: ["forest"], priority: FOREST_STAND, accepts: (c) => denseForest(c) && c.stand > 0.74 && c.pick < 0.3 },
      { biomes: JUNGLE, priority: 10, accepts: (c) => jungle(c) && c.stand > 0.78 && c.pick < 0.24 },
      { biomes: ["ancient_forest"], priority: 10, accepts: (c) => jungle(c) && c.roll < 0.4 },
    ],
    stamp: (writer, x, y0, z, seed) => stampRedwood(writer, x, y0, z, seed),
  }),
});

/* ------------------------------------------------------------------ */
/* Broadleaves                                                         */
/* ------------------------------------------------------------------ */

defineSpecies({
  ...SPECIES_BASE.extend({
    id: "birch",
    label: "Birch",
    habitats: [
      { biomes: ["forest"], priority: FOREST_GROVE, accepts: (c) => denseForest(c) && c.stand < 0.3 && c.pick >= 0.25 },
      { biomes: ["forest"], priority: FOREST_GENERAL, accepts: (c) => denseForest(c) && c.stand <= 0.74 && c.stand >= 0.3 && c.pick >= 0.28 && c.pick < 0.45 },
    ],
    stamp: (writer, x, y0, z, seed) => stampBirch(writer, x, y0, z, seed),
  }),
});

defineSpecies({
  ...SPECIES_BASE.extend({
    id: "oak",
    label: "Oak",
    habitats: [
      { biomes: ["forest"], priority: FOREST_GROVE, accepts: (c) => denseForest(c) && c.stand < 0.3 && c.pick < 0.25 },
      { biomes: ["forest"], priority: FOREST_STAND, accepts: (c) => denseForest(c) && c.stand > 0.74 && c.pick >= 0.62 },
      { biomes: ["forest"], priority: FOREST_GENERAL, accepts: (c) => denseForest(c) },
      { biomes: JUNGLE, priority: 30, accepts: (c) => jungle(c) },
      { biomes: ["ancient_forest"], priority: 20, accepts: (c) => jungle(c) },
      { biomes: FUNGAL, priority: 30, accepts: (c) => fungalForest(c) },
      { biomes: ["plains", "grassland"], priority: 10, accepts: (c) => growsOnSoil(c) && c.roll < 0.08 },
      { biomes: ["savanna"], priority: 20, accepts: (c) => savanna(c) && c.pick >= 0.24 && c.pick < 0.65 },
      { biomes: ["crystal_valley"], priority: 10, accepts: (c) => growsOnSoil(c) && c.roll < 0.15 },
    ],
    stamp: (writer, x, y0, z, seed) => stampOak(writer, x, y0, z, seed),
  }),
});

/** Seeded rainforest broadleaf with a flared, tiered canopy. */
defineSpecies({
  ...SPECIES_BASE.extend({
    id: "tropical",
    label: "Tropical tree",
    habitats: [
      { biomes: JUNGLE, priority: 20, accepts: (c) => jungle(c) && c.pick < 0.72 },
      { biomes: FUNGAL, priority: 10, accepts: (c) => fungalForest(c) && c.pick < 0.36 },
    ],
    stamp: (writer, x, y0, z, seed) => stampTropical(writer, x, y0, z, seed),
  }),
});

/** Broad-canopied savanna tree with a thick, variable trunk. */
defineSpecies({
  ...SPECIES_BASE.extend({
    id: "baobab",
    label: "Baobab",
    habitats: [
      { biomes: ["savanna"], priority: 10, accepts: (c) => savanna(c) && c.pick < 0.24 },
    ],
    stamp: (writer, x, y0, z, seed) => stampBaobab(writer, x, y0, z, seed),
  }),
});

defineSpecies({
  ...SPECIES_BASE.extend({
    id: "swamp_oak",
    label: "Swamp oak",
    habitats: [
      { biomes: WETLANDS, priority: 20, accepts: (c) => growsOnSoil(c) && c.roll < 0.5 },
    ],
    stamp: (writer, x, y0, z, seed) => stampOak(writer, x, y0, z, seed, true),
  }),
});

defineSpecies({
  ...SPECIES_BASE.extend({
    id: "willow",
    label: "Willow",
    habitats: [
      { biomes: WETLANDS, priority: 10, accepts: (c) => growsOnSoil(c) && c.roll < 0.5 && c.pick < 0.4 },
      { biomes: FUNGAL, priority: 20, accepts: (c) => fungalForest(c) && c.pick >= 0.36 && c.pick < 0.68 },
    ],
    stamp: (writer, x, y0, z, seed) => stampWillow(writer, x, y0, z, seed),
  }),
});

/* ------------------------------------------------------------------ */
/* Coastal, arid and understorey species                               */
/* ------------------------------------------------------------------ */

defineSpecies({
  ...SPECIES_BASE.extend({
    id: "palm",
    label: "Palm",
    habitats: [
      { biomes: ["beach", "coastal", "mangrove"], priority: 10, accepts: (c) => c.column.top === ID.sand && c.roll < 0.35 },
    ],
    stamp: (writer, x, y0, z, seed) => stampPalm(writer, x, y0, z, seed),
  }),
});

defineSpecies({
  ...SPECIES_BASE.extend({
    id: "cactus",
    label: "Cactus",
    habitats: [
      { biomes: ["desert", "badlands"], priority: 10, accepts: (c) => c.column.top === ID.sand && c.roll < 0.1 },
    ],
    stamp: (writer, x, y0, z, seed) => stampCactus(writer, x, y0, z, seed),
  }),
});

defineSpecies({
  ...SPECIES_BASE.extend({
    id: "shrub",
    label: "Shrub",
    habitats: [
      { biomes: ["plains", "grassland"], priority: 20, accepts: (c) => growsOnSoil(c) && c.roll >= 0.08 && c.roll < 0.18 },
      { biomes: ["savanna"], priority: 30, accepts: (c) => savanna(c) },
    ],
    stamp: (writer, x, y0, z, seed) => stampShrub(writer, x, y0, z, seed),
  }),
});

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

export interface SpeciesQuery {
  column: Column;
  /** Jittered-grid cell coordinates: species noise is keyed on the cell, not the tree. */
  cellX: number;
  cellZ: number;
  seed: number;
}

/**
 * Returns the species for a cell, or null when nothing grows there.
 * Lowest habitat priority wins; equal priorities keep registration order.
 */
export function selectSpecies(query: SpeciesQuery): SpeciesDefinition | null {
  const { column } = query;
  const context: SpeciesContext = {
    ...speciesRolls(query.cellX, query.cellZ, query.seed),
    column,
    growthSuitability: clamp01(
      0.88 +
        column.soilFertility * 0.17 +
        column.moisture * 0.1 -
        column.windExposure * 0.11 -
        column.slope * 0.02,
    ),
  };
  let best: { species: SpeciesDefinition; priority: number } | null = null;
  for (const species of SPECIES.list()) {
    for (const habitat of species.habitats) {
      if (!habitat.biomes.includes(column.biome)) continue;
      if (!habitat.accepts(context)) continue;
      if (!best || habitat.priority < best.priority) {
        best = { species, priority: habitat.priority };
      }
    }
  }
  return best?.species ?? null;
}
