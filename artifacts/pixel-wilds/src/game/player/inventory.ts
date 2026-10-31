/**
 * Player inventory and its per-world save slot.
 *
 * Every world owns its own inventory and position. The old single-player save
 * key is still read when no world id is supplied, which keeps existing data
 * reachable during the registry migration.
 */
import { BLOCK_TYPES, type BlockType } from "../blocks";
import type { Position } from "../physics";
import {
  LEGACY_PLAYER_SAVE_KEY,
  PLAYER_SAVE_PREFIX,
  browserStorage,
  type KeyValueStorage,
} from "../storage";
import type { GameMode } from "../world/profile";
export {
  INVENTORY_CAPACITY,
  INVENTORY_SLOT_COUNT,
  STACK_LIMIT,
  addItem,
  canAcceptItem,
  freeInventorySlots,
  inventoryCapacity,
  removeItem,
  sortedInventoryItems,
  stackCount,
  type InventorySort,
} from "../items/stacks";

export type Inventory = Record<BlockType, number>;

/** Creative starts with a stocked palette; survival starts with nothing. */
export const DEFAULT_INVENTORY: Inventory = Object.fromEntries(
  BLOCK_TYPES.map((type) => [
    type,
    type.endsWith("_ore")
      ? 6
      : type === "gold"
        ? 4
        : type === "glass" || type === "brick" || type === "roof"
          ? 16
          : type === "door" || type === "marble"
            ? 8
            : type === "chair" || type === "table"
              ? 6
              : 24,
  ]),
) as Inventory;

export function createInventory(mode: GameMode): Inventory {
  if (mode === "creative") return { ...DEFAULT_INVENTORY };
  return Object.fromEntries(BLOCK_TYPES.map((type) => [type, 0])) as Inventory;
}

/** Kept for callers that still refer to the pre-registry player key. */
export const PLAYER_SAVE_KEY = LEGACY_PLAYER_SAVE_KEY;

export interface PlayerSave {
  inventory: Inventory;
  position: Position | null;
}

function playerSaveKey(worldId: string | null): string {
  return worldId ? `${PLAYER_SAVE_PREFIX}${worldId}` : LEGACY_PLAYER_SAVE_KEY;
}

/** Reads the saved player, tolerating missing, malformed or foreign values. */
export function readPlayerSave(
  worldId?: string,
  storage: KeyValueStorage | null = browserStorage(),
): PlayerSave | null {
  if (!storage) return null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(playerSaveKey(worldId ?? null)) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as { inventory?: unknown; position?: unknown };
    const inventory = Object.fromEntries(BLOCK_TYPES.map((type) => [type, 0])) as Inventory;
    if (record.inventory && typeof record.inventory === "object") {
      for (const type of BLOCK_TYPES) {
        const count = Number((record.inventory as Record<string, unknown>)[type]);
        if (Number.isFinite(count) && count >= 0) inventory[type] = Math.floor(count);
      }
    }
    const position = record.position as Partial<Position> | null | undefined;
    if (
      position &&
      Number.isFinite(position.x) &&
      Number.isFinite(position.y) &&
      Number.isFinite(position.z)
    ) {
      return {
        inventory,
        position: { x: position.x as number, y: position.y as number, z: position.z as number },
      };
    }
    return { inventory, position: null };
  } catch {
    return null;
  }
}

/** Persists inventory and position. Returns false when storage is unavailable. */
export function savePlayer(
  worldId: string | null,
  inventory: Inventory,
  position: Position | null,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(playerSaveKey(worldId), JSON.stringify({ inventory, position }));
    return true;
  } catch {
    return false;
  }
}

export function deletePlayerSave(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage || !worldId) return;
  storage.removeItem(`${PLAYER_SAVE_PREFIX}${worldId}`);
}
