/**
 * Cached terrain facade.
 *
 * `Terrain` composes three independent models — height (elevation + rivers),
 * climate (temperature + moisture) and the surface classifier (biome rules) —
 * and owns the memoisation that makes chunk streaming affordable. It contains
 * no generation rules itself, so any of the three can be replaced or extended
 * without editing the cache or the callers.
 */
import { ID } from "../blocks";
import { columnKey } from "../noise";
import { climateAt, type Climate } from "./climate";
import { HeightModel } from "./height";
import { SURFACE_CLASSIFIER, buildSurfaceFacts } from "./surface";
import type { Column, HeightRecord } from "./types";

const MAX_CACHE = 60000;

/** Evict one oldest entry at a time instead of clearing the entire cache in one frame. */
function evictOldest<K, V>(cache: Map<K, V>, limit: number): void {
  if (cache.size < limit) return;
  const oldest = cache.keys().next();
  if (!oldest.done) cache.delete(oldest.value);
}

export class Terrain {
  private readonly heights: HeightModel;
  private naturalCache = new Map<string, HeightRecord>();
  private heightCache = new Map<string, HeightRecord>();
  private columnCache = new Map<string, Column>();

  constructor(readonly seed: number) {
    this.heights = new HeightModel(seed);
  }

  /** Natural height with no settlements applied. */
  natural(x: number, z: number): HeightRecord {
    const key = columnKey(x, z);
    const cached = this.naturalCache.get(key);
    if (cached) return cached;
    const record = this.heights.natural(x, z);
    evictOldest(this.naturalCache, MAX_CACHE);
    this.naturalCache.set(key, record);
    return record;
  }

  /** Final height, entirely derived from seeded geological fields. */
  height(x: number, z: number): HeightRecord {
    const key = columnKey(x, z);
    const cached = this.heightCache.get(key);
    if (cached) return cached;
    const record = this.natural(x, z);
    evictOldest(this.heightCache, MAX_CACHE);
    this.heightCache.set(key, record);
    return record;
  }

  climate(x: number, z: number, ground: number): Climate {
    return climateAt(this.seed, x, z, ground);
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
    const rec = this.height(x, z);
    const { ground } = rec;
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
    const facts = buildSurfaceFacts({
      seed: this.seed,
      x,
      z,
      rec,
      slope,
      temperature,
      moisture,
      neighbourWater,
    });

    const column: Column = {
      ...rec,
      biome: "plains",
      top: ID.grass,
      soil: ID.dirt,
      soilDepth: 3,
      mid: 0,
      midDepth: 0,
      rock: facts.rock,
      slope,
      temperature,
      moisture,
      frozen: facts.frozen,
      elevation: ground,
      rainfall: moisture * 1.2,
      windExposure: facts.windExposure,
      sunlight: facts.sunlight,
      geologicalComposition: facts.geologicalComposition,
      soilFertility: facts.soilFertility,
      soilComposition: facts.soilComposition,
    };

    SURFACE_CLASSIFIER.classify(column, facts);
    return column;
  }
}
