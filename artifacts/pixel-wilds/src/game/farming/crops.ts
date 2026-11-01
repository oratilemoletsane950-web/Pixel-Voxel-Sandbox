/**
 * Wheat farming.
 *
 * A crop is a pure record `(position, kind, plantedAt)` plus a stage block.
 * Growth is elapsed world time, so it continues while a chunk is unloaded and
 * survives a reload. The field never writes into an unloaded chunk; when the
 * chunk streams back in, `syncCropField` restores the correct stage.
 */
import { ID, type BlockType, type WorldBlockType } from "../blocks";
import { isChunkLoadedAt, getBlock, setBlock } from "../world/access";
import type { WorldData } from "../world/types";
import { DAY_LENGTH_SECONDS } from "../world/clock";

export const CROP_KINDS = ["wheat"] as const;
export type CropKind = (typeof CROP_KINDS)[number];

export interface CropDefinition {
  kind: CropKind;
  label: string;
  seed: BlockType;
  sprout: WorldBlockType;
  ripe: WorldBlockType;
  grain: BlockType;
  growSeconds: number;
  ripeGrain: number;
  ripeSeeds: number;
}

export const CROP_DEFINITIONS: Readonly<Record<CropKind, CropDefinition>> = Object.freeze({
  wheat: Object.freeze({
    kind: "wheat",
    label: "Wheat",
    seed: "wheat_seeds",
    sprout: "wheat_sprout",
    ripe: "wheat_ripe",
    grain: "wheat_grain",
    growSeconds: 75,
    ripeGrain: 3,
    ripeSeeds: 1,
  }),
});

export interface CropRecord {
  kind: CropKind;
  x: number;
  y: number;
  z: number;
  /** World-clock seconds at planting; growth wraps with the twelve-minute day. */
  plantedAt: number;
}

export interface CropField {
  records: readonly CropRecord[];
}

export type CropStage = "sprout" | "ripe";

export function createCropField(records: readonly CropRecord[] = []): CropField {
  const seen = new Set<string>();
  const valid: CropRecord[] = [];
  for (const record of records) {
    if (!isCropRecord(record) || seen.has(cropKey(record.x, record.y, record.z))) continue;
    seen.add(cropKey(record.x, record.y, record.z));
    valid.push({ ...record });
  }
  return { records: valid };
}

export function cropKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function isCropKind(value: unknown): value is CropKind {
  return typeof value === "string" && (CROP_KINDS as readonly string[]).includes(value);
}

export function isCropRecord(value: unknown): value is CropRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CropRecord>;
  return (
    isCropKind(record.kind) &&
    Number.isSafeInteger(record.x) &&
    Number.isSafeInteger(record.y) &&
    Number.isSafeInteger(record.z) &&
    Number.isFinite(record.plantedAt)
  );
}

/** Elapsed growth, safe across the clock wrapping at midnight. */
export function cropElapsed(record: CropRecord, worldTime: number): number {
  const delta = worldTime - record.plantedAt;
  return ((delta % DAY_LENGTH_SECONDS) + DAY_LENGTH_SECONDS) % DAY_LENGTH_SECONDS;
}

export function cropGrowth(record: CropRecord, worldTime: number): number {
  const definition = CROP_DEFINITIONS[record.kind];
  return Math.min(1, cropElapsed(record, worldTime) / definition.growSeconds);
}

export function cropStage(record: CropRecord, worldTime: number): CropStage {
  return cropGrowth(record, worldTime) >= 1 ? "ripe" : "sprout";
}

export function cropBlockForStage(kind: CropKind, stage: CropStage): WorldBlockType {
  return stage === "ripe" ? CROP_DEFINITIONS[kind].ripe : CROP_DEFINITIONS[kind].sprout;
}

export function cropAt(field: CropField, x: number, y: number, z: number): CropRecord | null {
  return field.records.find((record) => record.x === x && record.y === y && record.z === z) ?? null;
}

export interface PlantResult {
  field: CropField;
  planted: boolean;
  reason?: "occupied" | "not-farmland" | "blocked" | "unknown-kind";
}

/**
 * Plants above a farmland block. `y` is the crop cell, so `y - 1` must be
 * farmland and the crop cell must be empty or water.
 */
export function plantCrop(
  field: CropField,
  world: WorldData,
  x: number,
  y: number,
  z: number,
  worldTime: number,
  kind: CropKind = "wheat",
): PlantResult {
  if (!isCropKind(kind)) return { field, planted: false, reason: "unknown-kind" };
  if (!isChunkLoadedAt(world, x, z)) return { field, planted: false, reason: "not-farmland" };
  if (cropAt(field, x, y, z)) return { field, planted: false, reason: "occupied" };
  if (getBlock(world, x, y - 1, z) !== "farmland") {
    return { field, planted: false, reason: "not-farmland" };
  }
  const occupant = getBlock(world, x, y, z);
  if (occupant !== null && occupant !== "water") return { field, planted: false, reason: "blocked" };
  return {
    field: {
      records: [...field.records, { kind, x, y, z, plantedAt: worldTime }],
    },
    planted: true,
  };
}

export interface CropSyncResult {
  world: WorldData;
  field: CropField;
  changed: boolean;
}

/** Restores crop stage blocks for every loaded record and prunes invalid ones. */
export function syncCropField(field: CropField, world: WorldData, worldTime: number): CropSyncResult {
  let nextWorld = world;
  let changed = false;
  const kept: CropRecord[] = [];
  for (const record of field.records) {
    if (!isChunkLoadedAt(world, record.x, record.z)) {
      kept.push(record);
      continue;
    }
    const soil = getBlock(world, record.x, record.y - 1, record.z);
    const current = getBlock(world, record.x, record.y, record.z);
    if (soil !== "farmland" || (current !== "wheat_sprout" && current !== "wheat_ripe")) {
      changed = true;
      continue;
    }
    kept.push(record);
    const expected = cropBlockForStage(record.kind, cropStage(record, worldTime));
    if (current !== expected) {
      nextWorld = setBlock(nextWorld, record.x, record.y, record.z, expected);
      changed = true;
    }
  }
  return {
    world: nextWorld,
    field: changed && kept.length !== field.records.length ? { records: kept } : field,
    changed,
  };
}

export interface CropHarvest {
  field: CropField;
  record: CropRecord | null;
  stage: CropStage;
  yields: ReadonlyArray<{ item: BlockType; count: number }>;
}

/** Removes a planted crop and returns its deterministic yield. */
export function harvestCrop(field: CropField, x: number, y: number, z: number, worldTime: number): CropHarvest {
  const record = cropAt(field, x, y, z);
  if (!record) return { field, record: null, stage: "ripe", yields: [] };
  const stage = cropStage(record, worldTime);
  const definition = CROP_DEFINITIONS[record.kind];
  const yields = stage === "ripe"
    ? [
        { item: definition.grain, count: definition.ripeGrain },
        { item: definition.seed, count: definition.ripeSeeds },
      ]
    : [{ item: definition.seed, count: 1 }];
  return {
    field: { records: field.records.filter((entry) => entry !== record) },
    record,
    stage,
    yields,
  };
}

/** Wild settlement wheat has no record but still gives seed and grain. */
export function wildWheatYield(): ReadonlyArray<{ item: BlockType; count: number }> {
  return [
    { item: "wheat_grain", count: 2 },
    { item: "wheat_seeds", count: 1 },
  ];
}
