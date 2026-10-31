/**
 * Storage seams and save-key vocabulary.
 *
 * This module is deliberately dependency-free: the world registry, player
 * saves and settings all share one interface, so any of them can be tested
 * against an in-memory backend and later moved to IndexedDB or a server
 * without touching feature code.
 */

export interface KeyValueStorage {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
}

/** The browser's localStorage, or null when storage is unavailable. */
export function browserStorage(): KeyValueStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Registry of world profiles (names, modes, seeds, rules). */
export const WORLD_REGISTRY_KEY = "pixel-wilds-worlds-v1";
/** One block-edit snapshot per world id. */
export const WORLD_DATA_PREFIX = "pixel-wilds-world-data-v1:";
/** One player state (inventory, position) per world id. */
export const PLAYER_SAVE_PREFIX = "pixel-wilds-player-v3:";
/** One survival vitals snapshot (health, hunger, berries) per world id. */
export const SURVIVAL_SAVE_PREFIX = "pixel-wilds-survival-v1:";
/** One world clock snapshot per world id. */
export const WORLD_CLOCK_PREFIX = "pixel-wilds-clock-v1:";
/** One owned-tool belt (durability and selection) per world id. */
export const TOOL_SAVE_PREFIX = "pixel-wilds-tools-v1:";
/** Pre-registry single-player save, migrated on first launch. */
export const LEGACY_PLAYER_SAVE_KEY = "pixel-wilds-player-v2";
/** Application settings shared across worlds. */
export const SETTINGS_KEY = "pixel-wilds-settings-v1";
