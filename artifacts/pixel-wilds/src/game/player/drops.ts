/**
 * Dropped-block items and their shared simulation.
 *
 * Block breaks create small physical items instead of putting blocks straight
 * into the inventory. The same field is ticked by the WebGL renderer, the 2D
 * fallback and the tests, while the React layer only receives collected items.
 */
import { BLOCK_TYPES, type BlockType } from "../blocks";
import type { Position } from "../physics";
import {
  DROP_SAVE_PREFIX,
  browserStorage,
  type KeyValueStorage,
} from "../storage";
import { PLAYER_EYE_HEIGHT, type WorldData } from "../world/types";
import { isChunkLoadedAt, isSolidAt } from "../world/access";

export const MAX_DROPS = 160;
export const DROP_HALF_SIZE = 0.16;
export const DROP_PICKUP_DELAY = 0.35;
export const DROP_PICKUP_RADIUS = 1.75;
export const DROP_LIFETIME = 300;

const GRAVITY = 19.6;
const HORIZONTAL_DAMPING = 6;

export interface ItemDrop {
  id: number;
  item: BlockType;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  settled: boolean;
}

export interface DropSave {
  version: 1;
  drops: Array<{ item: BlockType; x: number; y: number; z: number }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBlockItem(value: unknown): value is BlockType {
  return typeof value === "string" && (BLOCK_TYPES as readonly string[]).includes(value);
}

function hashCell(x: number, y: number, z: number, salt: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + salt * 4.137) * 43758.5453;
  return value - Math.floor(value);
}

export function createBlockDrop(
  item: BlockType,
  cell: { x: number; y: number; z: number },
  id: number,
): ItemDrop {
  const angle = hashCell(cell.x, cell.y, cell.z, id) * Math.PI * 2;
  const spread = 0.18 + hashCell(cell.z, cell.x, cell.y, id + 1) * 0.12;
  return {
    id,
    item,
    x: cell.x + 0.5 + Math.cos(angle) * spread,
    y: cell.y + 0.55,
    z: cell.z + 0.5 + Math.sin(angle) * spread,
    vx: Math.cos(angle) * 1.1,
    vy: 2.2,
    vz: Math.sin(angle) * 1.1,
    age: 0,
    settled: false,
  };
}

/**
 * Mutable simulation owned outside React. Rendering can read `items` every
 * frame without forcing a component tree update.
 */
export class DropField {
  readonly items: ItemDrop[];
  private nextId = 1;

  constructor(initial: ItemDrop[] = []) {
    this.items = initial.slice(0, MAX_DROPS).map((drop) => ({ ...drop }));
    for (const drop of this.items) this.nextId = Math.max(this.nextId, drop.id + 1);
  }

  /** Adds one dropped block, or returns null when the field is full. */
  spawn(item: BlockType, cell: { x: number; y: number; z: number }): ItemDrop | null {
    if (!isBlockItem(item) || this.items.length >= MAX_DROPS) return null;
    const drop = createBlockDrop(item, cell, this.nextId);
    this.nextId += 1;
    this.items.push(drop);
    return drop;
  }

  /** Advances physics and returns items picked up during this tick. */
  tick(world: WorldData, player: Position, deltaSeconds: number): ItemDrop[] {
    const dt = Math.min(Math.max(deltaSeconds, 0), 0.05);
    const collected: ItemDrop[] = [];
    let kept = 0;
    for (const drop of this.items) {
      if (!isChunkLoadedAt(world, drop.x, drop.z)) {
        this.items[kept] = drop;
        kept += 1;
        continue;
      }
      drop.age += dt;
      if (drop.age >= DROP_LIFETIME || drop.y < -32) continue;

      if (drop.age >= DROP_PICKUP_DELAY && dropNearPlayer(drop, player)) {
        collected.push(drop);
        continue;
      }

      stepDrop(world, drop, dt);
      if (drop.y >= -32 && drop.age < DROP_LIFETIME) {
        this.items[kept] = drop;
        kept += 1;
      }
    }
    this.items.length = kept;
    return collected;
  }

  clear(): void {
    this.items.length = 0;
    this.nextId = 1;
  }

  serialize(): DropSave {
    return {
      version: 1,
      drops: this.items.map((drop) => ({
        item: drop.item,
        x: drop.x,
        y: drop.y,
        z: drop.z,
      })),
    };
  }
}

function dropNearPlayer(drop: ItemDrop, player: Position): boolean {
  const bodyY = player.y - PLAYER_EYE_HEIGHT + 1;
  return Math.hypot(drop.x - player.x, drop.y - bodyY, drop.z - player.z) <= DROP_PICKUP_RADIUS;
}

function stepDrop(world: WorldData, drop: ItemDrop, dt: number): void {
  const damping = Math.max(0, 1 - HORIZONTAL_DAMPING * dt);
  drop.vx *= damping;
  drop.vz *= damping;

  const nextX = drop.x + drop.vx * dt;
  if (!isSolidAt(world, Math.floor(nextX), Math.floor(drop.y), Math.floor(drop.z))) {
    drop.x = nextX;
  } else {
    drop.vx = 0;
  }
  const nextZ = drop.z + drop.vz * dt;
  if (!isSolidAt(world, Math.floor(drop.x), Math.floor(drop.y), Math.floor(nextZ))) {
    drop.z = nextZ;
  } else {
    drop.vz = 0;
  }

  drop.vy = Math.max(-24, drop.vy - GRAVITY * dt);
  const travel = drop.vy * dt;
  const steps = Math.max(1, Math.ceil(Math.abs(travel) / 0.25));
  for (let step = 0; step < steps; step += 1) {
    drop.y += travel / steps;
    if (drop.vy > 0) continue;
    const floorY = Math.floor(drop.y - DROP_HALF_SIZE - 0.001);
    if (isSolidAt(world, Math.floor(drop.x), floorY, Math.floor(drop.z))) {
      drop.y = floorY + 1 + DROP_HALF_SIZE;
      drop.vy = 0;
      drop.vx = 0;
      drop.vz = 0;
      drop.settled = true;
      return;
    }
  }
  drop.settled = false;
}

export function createDropField(initial: ItemDrop[] = []): DropField {
  return new DropField(initial);
}

function parseStoredDrop(value: unknown, id: number): ItemDrop | null {
  if (!isRecord(value) || !isBlockItem(value.item)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const z = Number(value.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  return { id, item: value.item, x, y, z, vx: 0, vy: 0, vz: 0, age: 0, settled: false };
}

export function dropSaveKey(worldId: string): string {
  return `${DROP_SAVE_PREFIX}${worldId}`;
}

/** Reads stored drops, ignoring malformed entries and capping the field size. */
export function readDropSave(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): ItemDrop[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(dropSaveKey(worldId)) || "null");
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.drops)) return [];
    const drops: ItemDrop[] = [];
    for (const entry of parsed.drops.slice(0, MAX_DROPS)) {
      const drop = parseStoredDrop(entry, drops.length + 1);
      if (drop) drops.push(drop);
    }
    return drops;
  } catch {
    return [];
  }
}

export function saveDropState(
  worldId: string,
  field: DropField,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    const key = dropSaveKey(worldId);
    if (field.items.length === 0) {
      storage.removeItem(key);
      return true;
    }
    storage.setItem(key, JSON.stringify(field.serialize()));
    return true;
  } catch {
    return false;
  }
}
