import { ID } from "./blocks";
import { MAX_BUILD_HEIGHT, SEA_LEVEL } from "./chunk";
import { clamp01, columnKey, hash2, lerp, smoothstep, valueNoise as vn } from "./noise";

/**
 * Terrain model (1 block = 0.5 m).
 *
 *  - Elevation is built from broad landforms (a few hundred blocks wide), a
 *    ridged mountain mask, and fine relief of a few blocks.
 *  - Rivers follow a warped iso-line of low-frequency noise. Their water level
 *    is flat across the channel and follows the smoothed land surface along
 *    it, they only run through low ground, and they carve a valley with banks.
 *  - Anything below SEA_LEVEL fills with water, which gives lakes and seas.
 *  - Temperature falls with altitude and moisture varies regionally; those
 *    pick the biome, which then picks the surface and the soil layers.
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
  /** Shared deterministic environmental inputs for geology and ecology. */
  sunlight: number;
  windExposure: number;
  soilFertility: number;
  soilComposition: "organic" | "loam" | "clay" | "sand" | "rock";
}

const MAX_CACHE = 60000;

/** Evict one oldest entry at a time instead of clearing the entire cache in one frame. */
function evictOldest<K, V>(cache: Map<K, V>, limit: number): void {
  if (cache.size < limit) return;
  const oldest = cache.keys().next();
  if (!oldest.done) cache.delete(oldest.value);
}

interface RiverHit {
  dist: number;
  half: number;
  bank: number;
  depth: number;
  ratio: number;
}

export class Terrain {
  private naturalCache = new Map<string, HeightRecord>();
  private heightCache = new Map<string, HeightRecord>();
  private columnCache = new Map<string, Column>();

  constructor(readonly seed: number) {}

  /* ---------------------------------------------------------------- */
  /* Natural height (no settlements)                                   */
  /* ---------------------------------------------------------------- */

  natural(x: number, z: number): HeightRecord {
    const key = columnKey(x, z);
    const cached = this.naturalCache.get(key);
    if (cached) return cached;
    const record = this.computeNatural(x, z);
    evictOldest(this.naturalCache, MAX_CACHE);
    this.naturalCache.set(key, record);
    return record;
  }

  private riverField(x: number, z: number, net: number): number {
    const s = this.seed + net * 977;
    const wx = x + (vn(x, z, 70, s + 1021) - 0.5) * 48 + (vn(x * 2, z * 2, 35, s + 1025) - 0.5) * 24;
    const wz = z + (vn(x + 500, z - 300, 70, s + 1031) - 0.5) * 48 + (vn(x * 2, z * 2, 35, s + 1033) - 0.5) * 24;
    const wide = net === 0;
    return (
      0.5 * vn(wx + 140, wz - 90, wide ? 280 : 140, s + 1001) +
      0.3 * vn(wx - 37, wz + 120, wide ? 100 : 52, s + 1007) +
      0.2 * vn(wx + 11, wz + 5, wide ? 40 : 22, s + 1013)
    );
  }

  private riverHit(x: number, z: number, net: number, broad: number): RiverHit | null {
    const n0 = this.riverField(x, z, net);
    const offset = Math.abs(n0 - 0.5);
    if (offset > 0.12) return null;
    const gx = (this.riverField(x + 3, z, net) - n0) / 3;
    const gz = (this.riverField(x, z + 3, net) - n0) / 3;
    const gradient = Math.max(Math.hypot(gx, gz), 0.0012);
    const dist = offset / gradient;

    // Rivers are widest and deepest on low ground and thin out into streams
    // and then disappear as the land climbs.
    const low = 1 - smoothstep((broad - SEA_LEVEL) / 60);
    const fade = 1 - smoothstep((broad - 68) / 16);
    const wide = net === 0;
    // A regional wetness mask leaves some areas river-free (drier plains,
    // building land) and confines tributaries to the wettest regions.
    const wet = vn(x + 90, z - 210, 520, this.seed + 1111);
    const mask = smoothstep((wet - (wide ? 0.5 : 0.62)) / 0.12);
    const half = (wide ? 1.6 + 6 * low : 1 + 2.6 * low) * fade * mask;
    if (half < 0.6) return null;
    const bank = 4 + half * 0.9;
    if (dist >= half + bank) return null;
    const depth = wide ? 2 + Math.round(3 * low) : 1 + Math.round(1.5 * low);
    return { dist, half, bank, depth, ratio: dist / (half + bank) };
  }

  private computeNatural(x: number, z: number): HeightRecord {
    const s = this.seed;
    const lowland = 0.48 * vn(x, z, 320, s) + 0.34 * vn(x, z, 128, s + 91) + 0.18 * vn(x + 43, z - 67, 48, s + 95);
    const continental = vn(x + 300, z - 150, 700, s + 17);
    const mountainField = vn(x + 226, z - 134, 420, s + 503);
    const mountain = smoothstep((mountainField - 0.58) / 0.3);
    const ridge = 1 - Math.abs(2 * vn(x - 164, z + 86, 150, s + 509) - 1);


    const rise = Math.pow(mountain, 1.25) * (40 + ridge * 120);
    const broad = 24 + lowland * 48 + (continental - 0.5) * 20 + rise;
    const fine = (0.6 * vn(x, z, 36, s + 177) + 0.4 * vn(x, z, 14, s + 251) - 0.5) * 12;
    const rough = (vn(x, z, 20, s + 311) - 0.5) * 24 * mountain;
    const jagged = (vn(x, z, 12, s + 401) - 0.5) * 16 * Math.pow(mountain, 1.5);
    let natural = Math.round(broad + fine * (1 - 0.4 * mountain) + rough + jagged);
    natural = Math.max(4, Math.min(MAX_BUILD_HEIGHT - 32, natural));


    let ground = natural;
    let water = natural < SEA_LEVEL ? SEA_LEVEL : 0;
    let riverDist = Infinity;
    let riverHalf = 0;

    if (broad > SEA_LEVEL + 1 && broad < 86) {
      let best: RiverHit | null = null;
      for (let net = 0; net < 2; net += 1) {
        const hit = this.riverHit(x, z, net, broad);
        if (hit && (!best || hit.ratio < best.ratio)) best = hit;
      }
      if (best) {
        riverDist = best.dist;
        riverHalf = best.half;
        const level = Math.max(SEA_LEVEL, Math.floor(broad) - 3);
        if (best.dist <= best.half) {
          const t = best.dist / best.half;
          const bed = Math.round(level - best.depth * (1 - t * t));
          ground = Math.min(natural, bed);
          water = ground < level ? level : 0;
        } else {
          // Valley bank: ease from a rim one block above the water to natural ground.
          const t = smoothstep((best.dist - best.half) / best.bank);
          ground = Math.round(lerp(level + 1, natural, t));
          water = ground < SEA_LEVEL ? SEA_LEVEL : 0;
        }
      }
    }

    return { ground, water, riverDist, riverHalfWidth: riverHalf, broad, mountain };
  }

  /* ---------------------------------------------------------------- */
  /* Final height (seeded geological terrain)                  */
  /* ---------------------------------------------------------------- */

  height(x: number, z: number): HeightRecord {
    const key = columnKey(x, z);
    const cached = this.heightCache.get(key);
    if (cached) return cached;
    // Height is entirely derived from seeded geological fields.
    const record = this.natural(x, z);
    evictOldest(this.heightCache, MAX_CACHE);
    this.heightCache.set(key, record);
    return record;
  }

  /* ---------------------------------------------------------------- */
  /* Climate and full column description                               */
  /* ---------------------------------------------------------------- */

  climate(x: number, z: number, ground: number): { temperature: number; moisture: number } {
    const s = this.seed;
    const base = 0.3 + 0.6 * (0.7 * vn(x - 31, z + 89, 500, s + 22) + 0.3 * vn(x + 9, z - 4, 170, s + 23));
    // Air cools with altitude (the "lapse rate"), so high ground gets cold.
    const temperature = base - Math.max(0, ground - SEA_LEVEL) / 170;
    const moisture = 0.7 * vn(x + 70, z - 46, 300, s + 7) + 0.3 * vn(x - 5, z + 60, 110, s + 8);
    return { temperature, moisture };
  }

  column(x: number, z: number): Column {
    const key = columnKey(x, z);
    const cached = this.columnCache.get(key);
    if (cached) return cached;
    const column = this.computeColumn(x, z);
    evictOldest(this.columnCache, MAX_CACHE);
    this.columnCache.set(key, column);
    return column;
  }

  private computeColumn(x: number, z: number): Column {
    const s = this.seed;
    const rec = this.height(x, z);
    const { ground, water } = rec;
    const east = this.height(x + 1, z);
    const west = this.height(x - 1, z);
    const south = this.height(x, z + 1);
    const north = this.height(x, z - 1);
    const slope = Math.max(
      Math.abs(east.ground - ground),
      Math.abs(west.ground - ground),
      Math.abs(south.ground - ground),
      Math.abs(north.ground - ground),
    );
    const neighbourWater = east.water > east.ground || west.water > west.ground ||
      south.water > south.ground || north.water > north.ground;

    const { temperature, moisture } = this.climate(x, z, ground);
    const elev = ground - SEA_LEVEL;
    const patch = 0.68 * vn(x - 91, z + 44, 18, s + 613) + 0.32 * vn(x + 12, z - 9, 5, s + 619);
    const sediment = 0.7 * vn(x + 17, z - 23, 24, s + 611) + 0.3 * vn(x - 31, z + 17, 7, s + 621);
    const geology = vn(x + 51, z + 12, 160, s + 211);
    const roll = hash2(x, z, s + 617);

    // Bedrock type: pink granite in the high country, pale limestone in
    // low basins, plain stone elsewhere.
    let rock: number = ID.stone;
    if (rec.mountain > 0.3 || elev > 55 || geology > 0.72) rock = ID.granite;
    else if (geology < 0.3 && elev < 50) rock = ID.limestone;

    const frozen = temperature < 0.22;
    const dryDesert = temperature > 0.62 && moisture < 0.46;
    // These normalized fields form a shared environment model. They are
    // continuous, seeded inputs rather than hand-authored placement markers.
    const sunlight = clamp01(0.92 - Math.min(0.58, slope * 0.075) - (ground > SEA_LEVEL + 65 ? 0.12 : 0));
    const windExposure = clamp01(0.18 + 0.52 * vn(x + 211, z - 97, 260, s + 733) + Math.min(0.3, Math.max(0, elev) / 240) + slope * 0.025);
    const soilFertility = clamp01(0.15 + moisture * 0.48 + vn(x - 17, z + 41, 95, s + 739) * 0.32 - Math.max(0, elev - 30) / 180 - slope * 0.035);
    const soilComposition: Column["soilComposition"] =
      slope >= 3 || elev > 62 ? "rock" :
      dryDesert || sediment < 0.24 || (ground <= SEA_LEVEL + 4 && patch > 0.76) ? "sand" :
      moisture > 0.65 && ground <= SEA_LEVEL + 8 ? "clay" :
      soilFertility > 0.62 ? "organic" : "loam";
    const forestiness = 0.48 * moisture + 0.32 * vn(x - 200, z + 61, 170, s + 701) + 0.20 * vn(x + 17, z - 43, 43, s + 703);
    const rainforest = temperature > 0.64 && moisture > 0.72 && forestiness > 0.51;
    const fungalForest = temperature > 0.38 && temperature < 0.67 && moisture > 0.75 && forestiness > 0.68 && patch > 0.44;
    const badlands = temperature > 0.54 && moisture < 0.34 && elev > 10 && geology > 0.46;
    const savanna = temperature > 0.61 && moisture >= 0.42 && moisture < 0.58 && forestiness < 0.59;
    const elevation = ground;
    const rainfall = moisture * 1.2;
    const geologicalComposition = rec.mountain > 0.3 || elev > 80 ? "granite" : geology < 0.3 ? "limestone" : "sedimentary";

    const column: Column = {
      ...rec,
      biome: "plains",
      top: ID.grass,
      soil: ID.dirt,
      soilDepth: 3,
      mid: 0,
      midDepth: 0,
      rock,
      slope,
      temperature,
      moisture,
      frozen,

      elevation,
      rainfall,
      windExposure,
      sunlight,
      geologicalComposition,
      soilFertility,
      soilComposition,
    };

    /* ---- Underwater: river beds and lake / sea floors ---- */
    if (water > ground) {
      const depth = water - ground;
      const inChannel = rec.riverDist < rec.riverHalfWidth + 1;
      if (inChannel && water > SEA_LEVEL) {
        column.biome = "river";
        column.top = rec.riverHalfWidth > 4.5 ? ID.sand : ID.gravel;
        if (sediment > 0.68) column.top = ID.clay;
        column.soil = column.top === ID.clay ? ID.clay : ID.sand;
        column.soilDepth = 2;
      } else {
        column.biome = "ocean";
        if (depth <= 3) column.top = frozen ? ID.gravel : ID.sand;
        else if (depth <= 10) column.top = sediment > 0.55 ? ID.clay : sediment < 0.25 ? ID.gravel : ID.sand;
        else column.top = sediment > 0.4 ? ID.clay : ID.gravel;
        column.soil = column.top === ID.clay ? ID.clay : ID.sand;
        column.soilDepth = 3;
      }
      return column;
    }

    /* ---- Shores and river banks ---- */
    const bankDist = rec.riverDist - rec.riverHalfWidth;
    const riverBank = rec.riverDist < Infinity && bankDist < 2.5 && ground <= SEA_LEVEL + 12;
    const lakeShore = ground <= SEA_LEVEL + 4 && (neighbourWater || ground <= SEA_LEVEL + 1);
    const swampy = moisture > 0.58 && ground <= SEA_LEVEL + 6 && temperature > 0.3;

    if (riverBank || lakeShore) {
      column.biome = riverBank && !lakeShore ? "river" : "beach";
      if (swampy) {
        column.top = patch > 0.35 ? ID.mud : ID.clay;
        column.soil = ID.mud;
        column.soilDepth = 2;
        column.biome = "swamp";
      } else if (riverBank && rec.riverHalfWidth <= 4.5) {
        column.top = patch > 0.62 ? ID.clay : patch < 0.28 ? ID.mud : ID.gravel;
        column.soil = ID.gravel;
        column.soilDepth = 2;
      } else if (frozen || sediment < 0.22) {
        column.top = ID.gravel;
        column.soil = ID.gravel;
        column.soilDepth = 2;
      } else {
        column.top = patch > 0.78 ? ID.clay : ID.sand;
        column.soil = ID.sand;
        column.soilDepth = 3;
      }
      if (slope >= 3) {
        column.top = rock;
        column.soilDepth = 0;
      }
      return column;
    }

    /* ---- Steep ground exposes rock ---- */
    if (slope >= 3 || (slope >= 2 && elev > 40)) {
      column.biome = elev > 20 ? (temperature < 0.3 ? "alpine" : "mountain") : "plains";
      column.top = rock;
      column.soil = rock;
      column.soilDepth = 0;
      if (frozen && slope < 4) column.top = ID.snow;
      return column;
    }
    if (slope === 2) {
      column.top = patch > 0.5 ? ID.gravel : ID.cobblestone;
      column.soil = ID.dirt;
      column.soilDepth = 2;
      column.biome = elev > 20 ? (temperature < 0.3 ? "alpine" : "mountain") : "plains";
      return column;
    }

    /* ---- Climate-driven surface ---- */
    // Volcanic areas
    if (geology > 0.85 && elev > 20) {
      column.biome = "volcanic";
      column.top = ID.gravel;
      column.soil = ID.stone;
      column.soilDepth = 1;
    } else if (frozen) {
      if (elev > 60) {
        column.biome = "alpine_meadow";
        column.top = patch > 0.6 ? ID.snow : ID.grass;
        column.soil = ID.dirt;
        column.soilDepth = 2;
      } else {
        column.biome = "tundra";
        column.top = ID.snow;
        column.soil = ID.dirt;
        column.soilDepth = 3;
      }
    } else if (temperature < 0.4) {
      if (elev > 40) {
        column.biome = "alpine_forest";
        column.top = temperature < 0.3 && patch > 0.6 ? ID.snow : patch < 0.16 ? ID.moss : ID.grass;
      } else {
        column.biome = temperature < 0.3 ? "boreal_forest" : "taiga";
        column.top = temperature < 0.3 && patch > 0.6 ? ID.snow : patch < 0.16 ? ID.moss : ID.grass;
      }
    } else if (dryDesert) {
      if (slope > 2) {
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
        if (roll < 0.015) column.top = ID.gravel;
      }
    } else if (swampy) {
      if (moisture > 0.85 && roll > 0.9) {
        column.biome = "bioluminescent_wetland";
        column.top = ID.mud;
        column.soil = ID.mud;
        column.soilDepth = 3;
      } else if (moisture > 0.75) {
        column.biome = "marsh";
        column.top = patch > 0.3 ? ID.mud : ID.clay;
        column.soil = ID.mud;
        column.soilDepth = 3;
      } else if (moisture > 0.68 && temperature > 0.5) {
        column.biome = "wetland";
        column.top = ID.mud;
        column.soil = ID.mud;
        column.soilDepth = 2;
      } else {
        column.biome = "swamp";
        column.top = patch > 0.45 ? ID.mud : ID.grass;
        column.soil = ID.mud;
        column.soilDepth = 2;
      }
    } else if (badlands) {
      column.biome = "badlands";
      column.top = patch > 0.63 ? ID.clay : ID.sandstone;
      column.soil = ID.clay;
      column.soilDepth = 2;
      column.mid = ID.sandstone;
      column.midDepth = 12;
    } else if (fungalForest) {
      column.biome = "fungal";
      column.top = ID.moss;
      column.soil = ID.moss;
      column.soilDepth = 3;
    } else if (rainforest) {
      column.biome = "rainforest";
      column.top = patch < 0.12 ? ID.moss : ID.grass;
      column.soil = patch > 0.74 ? ID.mud : ID.dirt;
      column.soilDepth = 4;
    } else if (forestiness > 0.52 && moisture > 0.42) {
      if (temperature > 0.65 && moisture > 0.65) {
        column.biome = "tropical_rainforest";
        column.top = ID.grass;
        column.soil = ID.dirt;
        column.soilDepth = 4;
      } else if (forestiness > 0.75 && roll > 0.6) {
        if (moisture > 0.7 && roll > 0.9) {
          column.biome = "fungal_forest";
        } else {
          column.biome = "ancient_forest";
        }
        column.top = ID.grass;
        column.soil = ID.dirt;
        column.soilDepth = 4;
      } else {
        column.biome = "forest";
        column.top = patch < 0.1 ? ID.moss : ID.grass;
      }
    } else if (savanna || (temperature > 0.55 && moisture < 0.5)) {
      column.biome = "savanna";
      column.top = ID.grass;
      column.soil = ID.dirt;
      column.soilDepth = 3;
    } else {
      column.biome = moisture > 0.4 ? "grassland" : "plains";
      column.top = ID.grass;
    }

    // High ground thins out: grass gives way to bare rock and scree.
    if (elev > 80 && column.biome !== "desert") {
      const rockiness = clamp01((elev - 80) / 60);
      if (patch < rockiness * 0.9 + (roll - 0.5) * 0.15) {
        column.top = roll > 0.7 ? ID.gravel : rock;
        column.soil = rock;
        column.soilDepth = 0;
        column.biome = "mountain";
      } else if (elev > 100) {
        column.biome = "mountain";
      }
    }
    return column;
  }
}
