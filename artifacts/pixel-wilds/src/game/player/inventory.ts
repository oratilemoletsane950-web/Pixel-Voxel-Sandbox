/**
 * Player inventory and its save slot.
 *
 * Split out of `App.tsx` so inventory persistence can be tested, reused by a
 * future menu or server, and extended (new block types, stacks, tools) without
 * touching the React component tree.
 */
import { BLOCK_TYPES, type BlockType } from "../blocks";
import type { Position } from "../physics";

export type Inventory = Record<BlockType, number>;

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

export const PLAYER_SAVE_KEY = "pixel-wilds-player-v2";

export interface PlayerSave {
  inventory: Inventory;
  position: Position | null;
}

/** Reads the saved player, tolerating missing, malformed or foreign values. */
export function readPlayerSave(): PlayerSave | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAYER_SAVE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    const inventory = { ...DEFAULT_INVENTORY };
    if (parsed.inventory && typeof parsed.inventory === "object") {
      for (const type of BLOCK_TYPES) {
        const count = Number(parsed.inventory[type]);
        if (Number.isFinite(count) && count >= 0) inventory[type] = Math.floor(count);
      }
    }
    const position = parsed.position;
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
export function savePlayer(inventory: Inventory, position: Position | null): boolean {
  try {
    localStorage.setItem(PLAYER_SAVE_KEY, JSON.stringify({ inventory, position }));
    return true;
  } catch {
    // The world helper remains the primary save path if local storage is unavailable.
    return false;
  }
}
