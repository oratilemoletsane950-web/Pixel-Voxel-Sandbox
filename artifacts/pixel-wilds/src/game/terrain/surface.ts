/**
 * Surface classification: which biome a column belongs to and which blocks
 * dress it.
 *
 * This used to be one long `if / else if` chain inside `Terrain.column()`.
 * Adding a biome meant inserting a branch in the right position, and the
 * precedence was implicit in the order of the `else if`s. It is now an ordered
 * list of rules, each a small strategy object:
 *
 *   - `order` is precedence (lower first), so a new biome is inserted by
 *     choosing a number, not by moving code;
 *   - `apply()` returns true when it has settled the column;
 *   - `classify()` reports which rule won, which makes terrain decisions
 *     observable in tests and diagnostics.
 *
 * The rules reproduce the historical precedence exactly:
 * underwater -> shore -> steep rock -> slope shelf -> volcanic -> frozen ->
 * cold -> arid -> wetland -> badlands -> fungal -> rainforest -> forest ->
 * savanna -> open ground, then shared high-ground thinning and soil variation.
 */
import { ID } from "../blocks";
import { SEA_LEVEL } from "../chunk";
import { clamp01, hash2, valueNoise as vn } from "../noise";
import type { Column, HeightRecord } from "./types";

export interface SurfaceFacts {
  seed: number;
  x: number;
  z: number;
  ground: number;
  water: number;
  riverDist: number;
  riverHalfWidth: number;
  slope: number;
  elev: number;
  patch: number;
  sediment: number;
  geology: number;
  roll: number;
  rock: number;
  frozen: boolean;
  dryDesert: boolean;
  swampy: boolean;
  neighbourWater: boolean;
  forestiness: number;
  rainforest: boolean;
  fungalForest: boolean;
  badlands: boolean;
  savanna: boolean;
  temperature: number;
  moisture: number;
  sunlight: number;
  windExposure: number;
  soilFertility: number;
  soilComposition: Column["soilComposition"];
  geologicalComposition: string;
}

export interface SurfaceInput {
  seed: number;
  x: number;
  z: number;
  rec: HeightRecord;
  slope: number;
  temperature: number;
  moisture: number;
  neighbourWater: boolean;
}

/** Deterministic environmental inputs shared by geology and ecology. */
export function buildSurfaceFacts(input: SurfaceInput): SurfaceFacts {
  const { seed, x, z, rec, slope, temperature, moisture, neighbourWater } = input;
  const { ground } = rec;
  const elev = ground - SEA_LEVEL;
  const patch = 0.68 * vn(x - 91, z + 44, 18, seed + 613) + 0.32 * vn(x + 12, z - 9, 5, seed + 619);
  const sediment = 0.7 * vn(x + 17, z - 23, 24, seed + 611) + 0.3 * vn(x - 31, z + 17, 7, seed + 621);
  const geology = vn(x + 51, z + 12, 160, seed + 211);
  const roll = hash2(x, z, seed + 617);

  // Bedrock type: pink granite in the high country, pale limestone in low
  // basins, plain stone elsewhere.
  let rock: number = ID.stone;
  if (rec.mountain > 0.3 || elev > 55 || geology > 0.72) rock = ID.granite;
  else if (geology < 0.3 && elev < 50) rock = ID.limestone;

  const frozen = temperature < 0.22;
  const dryDesert = temperature > 0.62 && moisture < 0.46;
  // These normalized fields form a shared environment model. They are
  // continuous, seeded inputs rather than hand-authored placement markers.
  const sunlight = clamp01(0.92 - Math.min(0.58, slope * 0.075) - (ground > SEA_LEVEL + 65 ? 0.12 : 0));
  const windExposure = clamp01(0.18 + 0.52 * vn(x + 211, z - 97, 260, seed + 733) + Math.min(0.3, Math.max(0, elev) / 240) + slope * 0.025);
  const soilFertility = clamp01(0.15 + moisture * 0.48 + vn(x - 17, z + 41, 95, seed + 739) * 0.32 - Math.max(0, elev - 30) / 180 - slope * 0.035);
  const soilComposition: Column["soilComposition"] =
    slope >= 3 || elev > 62 ? "rock" :
    dryDesert || sediment < 0.24 || (ground <= SEA_LEVEL + 4 && patch > 0.76) ? "sand" :
    moisture > 0.65 && ground <= SEA_LEVEL + 8 ? "clay" :
    soilFertility > 0.62 ? "organic" : "loam";
  const forestiness = 0.48 * moisture + 0.32 * vn(x - 200, z + 61, 170, seed + 701) + 0.20 * vn(x + 17, z - 43, 43, seed + 703);
  const swampy = moisture > 0.58 && ground <= SEA_LEVEL + 6 && temperature > 0.3;
  const rainforest = temperature > 0.64 && moisture > 0.72 && forestiness > 0.51;
  const fungalForest = temperature > 0.38 && temperature < 0.67 && moisture > 0.75 && forestiness > 0.68 && patch > 0.44;
  const badlands = temperature > 0.54 && moisture < 0.34 && elev > 10 && geology > 0.46;
  const savanna = temperature > 0.61 && moisture >= 0.42 && moisture < 0.58 && forestiness < 0.59;
  const geologicalComposition = rec.mountain > 0.3 || elev > 80 ? "granite" : geology < 0.3 ? "limestone" : "sedimentary";

  return {
    seed,
    x,
    z,
    ground,
    water: rec.water,
    riverDist: rec.riverDist,
    riverHalfWidth: rec.riverHalfWidth,
    slope,
    elev,
    patch,
    sediment,
    geology,
    roll,
    rock,
    frozen,
    dryDesert,
    swampy,
    neighbourWater,
    forestiness,
    rainforest,
    fungalForest,
    badlands,
    savanna,
    temperature,
    moisture,
    sunlight,
    windExposure,
    soilFertility,
    soilComposition,
    geologicalComposition,
  };
}

export interface SurfaceRule {
  readonly id: string;
  /** Lower runs first: this is the rule's precedence. */
  readonly order: number;
  /** Returns true when the rule has settled the column. */
  apply(column: Column, facts: SurfaceFacts): boolean;
}

/* ------------------------------------------------------------------ */
/* Rules, in precedence order                                          */
/* ------------------------------------------------------------------ */

const underwater: SurfaceRule = {
  id: "underwater",
  order: 10,
  apply(column, f) {
    if (f.water <= f.ground) return false;
    const depth = f.water - f.ground;
    const inChannel = f.riverDist < f.riverHalfWidth + 1;
    if (inChannel && f.water > SEA_LEVEL) {
      column.biome = "river";
      column.top = f.riverHalfWidth > 4.5 ? ID.sand : ID.gravel;
      if (f.sediment > 0.68) column.top = ID.clay;
      column.soil = column.top === ID.clay ? ID.clay : ID.sand;
      column.soilDepth = 2;
    } else {
      column.biome = "ocean";
      if (depth <= 3) column.top = f.frozen ? ID.gravel : ID.sand;
      else if (depth <= 10) column.top = f.sediment > 0.55 ? ID.clay : f.sediment < 0.25 ? ID.gravel : ID.sand;
      else column.top = f.sediment > 0.4 ? ID.clay : ID.gravel;
      column.soil = column.top === ID.clay ? ID.clay : ID.sand;
      column.soilDepth = 3;
    }
    return true;
  },
};

const shore: SurfaceRule = {
  id: "shore",
  order: 20,
  apply(column, f) {
    const bankDist = f.riverDist - f.riverHalfWidth;
    const riverBank = f.riverDist < Infinity && bankDist < 2.5 && f.ground <= SEA_LEVEL + 12;
    const lakeShore = f.ground <= SEA_LEVEL + 4 && (f.neighbourWater || f.ground <= SEA_LEVEL + 1);
    if (!riverBank && !lakeShore) return false;

    column.biome = riverBank && !lakeShore ? "river" : "beach";
    if (f.swampy) {
      column.top = f.patch > 0.35 ? ID.mud : ID.clay;
      column.soil = ID.mud;
      column.soilDepth = 2;
      column.biome = "swamp";
    } else if (riverBank && f.riverHalfWidth <= 4.5) {
      column.top = f.patch > 0.62 ? ID.clay : f.patch < 0.28 ? ID.mud : ID.gravel;
      column.soil = ID.gravel;
      column.soilDepth = 2;
    } else if (f.frozen || f.sediment < 0.22) {
      column.top = ID.gravel;
      column.soil = ID.gravel;
      column.soilDepth = 2;
    } else {
      column.top = f.patch > 0.78 ? ID.clay : ID.sand;
      column.soil = ID.sand;
      column.soilDepth = 3;
    }
    if (f.slope >= 3) {
      column.top = f.rock;
      column.soilDepth = 0;
    }
    return true;
  },
};

const steepRock: SurfaceRule = {
  id: "steep-rock",
  order: 30,
  apply(column, f) {
    if (!(f.slope >= 3 || (f.slope >= 2 && f.elev > 40))) return false;
    column.biome = f.elev > 20 ? (f.temperature < 0.3 ? "alpine" : "mountain") : "plains";
    column.top = f.rock;
    column.soil = f.rock;
    column.soilDepth = 0;
    if (f.frozen && f.slope < 4) column.top = ID.snow;
    return true;
  },
};

const slopeShelf: SurfaceRule = {
  id: "slope-shelf",
  order: 40,
  apply(column, f) {
    if (f.slope !== 2) return false;
    column.top = f.patch > 0.5 ? ID.gravel : ID.cobblestone;
    column.soil = ID.dirt;
    column.soilDepth = 2;
    column.biome = f.elev > 20 ? (f.temperature < 0.3 ? "alpine" : "mountain") : "plains";
    return true;
  },
};

const volcanic: SurfaceRule = {
  id: "volcanic",
  order: 100,
  apply(column, f) {
    if (!(f.geology > 0.85 && f.elev > 20)) return false;
    column.biome = "volcanic";
    column.top = ID.gravel;
    column.soil = ID.stone;
    column.soilDepth = 1;
    return true;
  },
};

const frozen: SurfaceRule = {
  id: "frozen",
  order: 110,
  apply(column, f) {
    if (!f.frozen) return false;
    if (f.elev > 60) {
      column.biome = "alpine_meadow";
      column.top = f.patch > 0.6 ? ID.snow : ID.grass;
      column.soil = ID.dirt;
      column.soilDepth = 2;
    } else {
      column.biome = "tundra";
      column.top = ID.snow;
      column.soil = ID.dirt;
      column.soilDepth = 3;
    }
    return true;
  },
};

const cold: SurfaceRule = {
  id: "cold",
  order: 120,
  apply(column, f) {
    if (!(f.temperature < 0.4)) return false;
    const top = f.temperature < 0.3 && f.patch > 0.6 ? ID.snow : f.patch < 0.16 ? ID.moss : ID.grass;
    if (f.elev > 40) {
      column.biome = "alpine_forest";
      column.top = top;
    } else {
      column.biome = f.temperature < 0.3 ? "boreal_forest" : "taiga";
      column.top = top;
    }
    return true;
  },
};

const arid: SurfaceRule = {
  id: "arid",
  order: 130,
  apply(column, f) {
    if (!f.dryDesert) return false;
    if (f.slope > 2) {
      column.biome = "badlands";
      column.top = ID.sandstone;
      column.soil = ID.gravel;
      column.soilDepth = 2;
    } else {
      column.biome = "desert";
      column.top = ID.sand;
      column.soil = ID.sand;
      column.soilDepth = 4;
      column.mid = ID.sandstone;
      column.midDepth = 8;
      if (f.roll < 0.015) column.top = ID.gravel;
    }
    return true;
  },
};

const wetland: SurfaceRule = {
  id: "wetland",
  order: 140,
  apply(column, f) {
    if (!f.swampy) return false;
    if (f.moisture > 0.85 && f.roll > 0.9) {
      column.biome = "bioluminescent_wetland";
      column.top = ID.mud;
      column.soil = ID.mud;
      column.soilDepth = 3;
    } else if (f.moisture > 0.75) {
      column.biome = "marsh";
      column.top = f.patch > 0.3 ? ID.mud : ID.clay;
      column.soil = ID.mud;
      column.soilDepth = 3;
    } else if (f.moisture > 0.68 && f.temperature > 0.5) {
      column.biome = "wetland";
      column.top = ID.mud;
      column.soil = ID.mud;
      column.soilDepth = 2;
    } else {
      column.biome = "swamp";
      column.top = f.patch > 0.45 ? ID.mud : ID.grass;
      column.soil = ID.mud;
      column.soilDepth = 2;
    }
    return true;
  },
};

const erodedBadlands: SurfaceRule = {
  id: "eroded-badlands",
  order: 141,
  apply(column, f) {
    if (!f.badlands) return false;
    column.biome = "badlands";
    column.top = f.patch > 0.63 ? ID.clay : ID.sandstone;
    column.soil = ID.clay;
    column.soilDepth = 2;
    column.mid = ID.sandstone;
    column.midDepth = 12;
    return true;
  },
};

const fungal: SurfaceRule = {
  id: "fungal",
  order: 142,
  apply(column, f) {
    if (!f.fungalForest) return false;
    column.biome = "fungal";
    column.top = ID.moss;
    column.soil = ID.moss;
    column.soilDepth = 3;
    return true;
  },
};

const rainforest: SurfaceRule = {
  id: "rainforest",
  order: 143,
  apply(column, f) {
    if (!f.rainforest) return false;
    column.biome = "rainforest";
    column.top = f.patch < 0.12 ? ID.moss : ID.grass;
    column.soil = f.patch > 0.74 ? ID.mud : ID.dirt;
    column.soilDepth = 4;
    return true;
  },
};

const forest: SurfaceRule = {
  id: "forest",
  order: 150,
  apply(column, f) {
    if (!(f.forestiness > 0.52 && f.moisture > 0.42)) return false;
    if (f.temperature > 0.65 && f.moisture > 0.65) {
      column.biome = "tropical_rainforest";
      column.top = ID.grass;
      column.soil = ID.dirt;
      column.soilDepth = 4;
    } else if (f.forestiness > 0.75 && f.roll > 0.6) {
      if (f.moisture > 0.7 && f.roll > 0.9) {
        column.biome = "fungal_forest";
      } else {
        column.biome = "ancient_forest";
      }
      column.top = ID.grass;
      column.soil = ID.dirt;
      column.soilDepth = 4;
    } else {
      column.biome = "forest";
      column.top = f.patch < 0.1 ? ID.moss : ID.grass;
    }
    return true;
  },
};

const savanna: SurfaceRule = {
  id: "savanna",
  order: 160,
  apply(column, f) {
    if (!(f.savanna || (f.temperature > 0.55 && f.moisture < 0.5))) return false;
    column.biome = "savanna";
    column.top = f.patch > 0.76 ? ID.thatch : ID.grass;
    column.soil = ID.dirt;
    column.soilDepth = 2 + Math.floor(hash2(f.x, f.z, f.seed + 763) * 2);
    return true;
  },
};

const openGround: SurfaceRule = {
  id: "open-ground",
  order: 200,
  apply(column, f) {
    column.biome = f.moisture > 0.4 ? "grassland" : "plains";
    column.top = ID.grass;
    return true;
  },
};

const DEFAULT_RULES: readonly SurfaceRule[] = [
  underwater,
  shore,
  steepRock,
  slopeShelf,
  volcanic,
  frozen,
  cold,
  arid,
  wetland,
  erodedBadlands,
  fungal,
  rainforest,
  forest,
  savanna,
  openGround,
];

/* ------------------------------------------------------------------ */
/* Classifier                                                          */
/* ------------------------------------------------------------------ */

export class SurfaceClassifier {
  private readonly rules: readonly SurfaceRule[];

  constructor(rules: readonly SurfaceRule[] = DEFAULT_RULES) {
    const ids = new Set<string>();
    for (const rule of rules) {
      if (!rule.id) throw new Error("Surface rule needs an id");
      if (ids.has(rule.id)) throw new Error(`Duplicate surface rule "${rule.id}"`);
      if (!Number.isFinite(rule.order)) throw new Error(`Surface rule "${rule.id}" needs an order`);
      ids.add(rule.id);
    }
    this.rules = [...rules].sort((a, b) => a.order - b.order);
  }

  list(): readonly SurfaceRule[] {
    return this.rules;
  }

  /** Settles the column's biome and surface. Returns the winning rule's id. */
  classify(column: Column, facts: SurfaceFacts): string {
    let settledBy = "unsettled";
    for (const rule of this.rules) {
      if (!rule.apply(column, facts)) continue;
      settledBy = rule.id;
      break;
    }
    thinHighGround(column, facts);
    varySoilDepth(column, facts);
    return settledBy;
  }
}

/** High ground thins out: grass gives way to bare rock and scree. */
function thinHighGround(column: Column, facts: SurfaceFacts): void {
  if (facts.elev <= 80 || column.biome === "desert") return;
  const biome = facts.temperature < 0.3 ? "alpine" : "mountain";
  const rockiness = clamp01((facts.elev - 80) / 60);
  if (facts.patch < rockiness * 0.9 + (facts.roll - 0.5) * 0.15) {
    column.top = facts.roll > 0.7 ? ID.gravel : facts.rock;
    column.soil = facts.rock;
    column.soilDepth = 0;
    column.biome = biome;
  } else if (facts.elev > 100) {
    column.biome = biome;
  }
}

/** Seeded organic variation: deeper loam under fertility, thinner on rock. */
function varySoilDepth(column: Column, facts: SurfaceFacts): void {
  if (column.soilDepth <= 0 || column.biome === "desert" || column.biome === "badlands") return;
  const variation = Math.floor(hash2(facts.x, facts.z, facts.seed + 761) * 3) - 1;
  const organicBoost = facts.soilComposition === "organic" ? 1 : 0;
  column.soilDepth = Math.max(1, Math.min(6, column.soilDepth + variation + organicBoost));
}

export const SURFACE_CLASSIFIER = new SurfaceClassifier();
