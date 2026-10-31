/**
 * Chest contents: one bounded block-count bag per placed chest cell.
 *
 * Contents are stored by world and position, not inside the world's terrain
 * edit snapshot. That keeps block editing and item storage independently
 * versioned while giving chests a save format they can grow into later.
 */
import { BLOCK_TYPES, type BlockType } from "./blocks";
import {
  CONTAINER_SAVE_PREFIX,
  browserStorage,
  type KeyValueStorage,
} from "./storage";
import type { Inventory } from "./player/inventory";

export const CONTAINER_CAPACITY = 512;

export type ContainerContents = Partial<Record<BlockType, number>>;
export type ContainerMap = Record<string, ContainerContents>;

export interface ContainerTransfer {
  contents: ContainerContents;
  inventory: Inventory;
  moved: number;
  blocked: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isItem(value: string): value is BlockType {
  return (BLOCK_TYPES as readonly string[]).includes(value);
}

export function containerKey(cell: { x: number; y: number; z: number }): string {
  return `${cell.x},${cell.y},${cell.z}`;
}

export function parseContainerKey(key: string): { x: number; y: number; z: number } | null {
  const parts = key.split(",").map(Number);
  if (parts.length !== 3 || !parts.every(Number.isSafeInteger)) return null;
  return { x: parts[0], y: parts[1], z: parts[2] };
}

export function containerTotal(contents: ContainerContents): number {
  return Object.values(contents).reduce((total, count) => total + (count ?? 0), 0);
}

export function containerSaveKey(worldId: string): string {
  return `${CONTAINER_SAVE_PREFIX}${worldId}`;
}

/** Moves up to `amount` of one item from the player's pack into a chest. */
export function deposit(
  contents: ContainerContents,
  inventory: Inventory,
  item: BlockType,
  amount: number,
): ContainerTransfer {
  const requested = Math.max(0, Math.floor(amount));
  const room = Math.max(0, CONTAINER_CAPACITY - containerTotal(contents));
  const moved = Math.min(requested, inventory[item] ?? 0, room);
  if (moved <= 0) return { contents, inventory, moved: 0, blocked: requested > room };
  return {
    contents: { ...contents, [item]: (contents[item] ?? 0) + moved },
    inventory: { ...inventory, [item]: Math.max(0, inventory[item] - moved) },
    moved,
    blocked: requested > room,
  };
}

/** Moves up to `amount` of one item from a chest back into the pack. */
export function withdraw(
  contents: ContainerContents,
  inventory: Inventory,
  item: BlockType,
  amount: number,
): ContainerTransfer {
  const requested = Math.max(0, Math.floor(amount));
  const moved = Math.min(requested, contents[item] ?? 0);
  if (moved <= 0) return { contents, inventory, moved: 0, blocked: false };
  const nextContents = { ...contents };
  const remaining = (contents[item] ?? 0) - moved;
  if (remaining > 0) nextContents[item] = remaining;
  else delete nextContents[item];
  return {
    contents: nextContents,
    inventory: { ...inventory, [item]: (inventory[item] ?? 0) + moved },
    moved,
    blocked: false,
  };
}

/** Reads all chests for a world, dropping malformed cells and excess stacks. */
export function readContainers(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): ContainerMap {
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(containerSaveKey(worldId)) || "null");
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.containers)) return {};
    const containers: ContainerMap = {};
    for (const [key, raw] of Object.entries(parsed.containers)) {
      if (!parseContainerKey(key) || !isRecord(raw)) continue;
      const contents: ContainerContents = {};
      let total = 0;
      for (const [item, count] of Object.entries(raw)) {
        if (!isItem(item)) continue;
        const value = Math.floor(Number(count));
        if (!Number.isFinite(value) || value <= 0) continue;
        const allowed = Math.min(value, CONTAINER_CAPACITY - total);
        if (allowed <= 0) break;
        contents[item] = allowed;
        total += allowed;
      }
      if (total > 0) containers[key] = contents;
    }
    return containers;
  } catch {
    return {};
  }
}

export function saveContainers(
  worldId: string,
  containers: ContainerMap,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    const key = containerSaveKey(worldId);
    const nonEmpty = Object.fromEntries(
      Object.entries(containers).filter(([, contents]) => containerTotal(contents) > 0),
    );
    if (Object.keys(nonEmpty).length === 0) {
      storage.removeItem(key);
      return true;
    }
    storage.setItem(key, JSON.stringify({ version: 1, containers: nonEmpty }));
    return true;
  } catch {
    return false;
  }
}
