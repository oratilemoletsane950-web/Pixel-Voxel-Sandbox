/**
 * The complete set of per-world save slots.
 *
 * Terrain, player, survival, clock, tools, drops and chests have separate
 * formats and readers. Keeping their key prefixes in one ordered table means
 * duplication, deletion and portable archives cannot silently omit a feature
 * that was added later.
 */
import {
  CONTAINER_SAVE_PREFIX,
  DROP_SAVE_PREFIX,
  PLAYER_SAVE_PREFIX,
  SURVIVAL_SAVE_PREFIX,
  TOOL_SAVE_PREFIX,
  WORLD_CLOCK_PREFIX,
  WORLD_DATA_PREFIX,
  browserStorage,
  type KeyValueStorage,
} from "../storage";

export interface WorldSaveSlot {
  id: "data" | "player" | "survival" | "clock" | "tools" | "drops" | "chests";
  prefix: string;
  label: string;
}

/** Append new per-world saves here; all consumers enumerate this table. */
export const WORLD_SAVE_SLOTS: readonly WorldSaveSlot[] = Object.freeze([
  { id: "data", prefix: WORLD_DATA_PREFIX, label: "terrain" },
  { id: "player", prefix: PLAYER_SAVE_PREFIX, label: "inventory and position" },
  { id: "survival", prefix: SURVIVAL_SAVE_PREFIX, label: "vitals" },
  { id: "clock", prefix: WORLD_CLOCK_PREFIX, label: "world clock" },
  { id: "tools", prefix: TOOL_SAVE_PREFIX, label: "toolbelt" },
  { id: "drops", prefix: DROP_SAVE_PREFIX, label: "dropped items" },
  { id: "chests", prefix: CONTAINER_SAVE_PREFIX, label: "chests" },
]);

export type WorldSaveSlotId = WorldSaveSlot["id"];
export type WorldSaveSlotMap = Partial<Record<WorldSaveSlotId, string>>;

export function worldSaveKey(worldId: string, slot: WorldSaveSlot): string {
  return `${slot.prefix}${worldId}`;
}

/** Reads every present save slot as its original, already-validated string. */
export function readWorldSaveSlots(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): WorldSaveSlotMap {
  const saves: WorldSaveSlotMap = {};
  if (!storage || !worldId) return saves;
  for (const slot of WORLD_SAVE_SLOTS) {
    const raw = storage.getItem(worldSaveKey(worldId, slot));
    if (raw !== null) saves[slot.id] = raw;
  }
  return saves;
}

export function writeWorldSaveSlots(
  worldId: string,
  saves: WorldSaveSlotMap,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage || !worldId) throw new Error("A world id and storage are required.");
  for (const slot of WORLD_SAVE_SLOTS) {
    const raw = saves[slot.id];
    if (raw === undefined) storage.removeItem(worldSaveKey(worldId, slot));
    else storage.setItem(worldSaveKey(worldId, slot), raw);
  }
}

export function copyWorldSaveSlots(
  fromId: string,
  toId: string,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage || !fromId || !toId || fromId === toId) return;
  for (const slot of WORLD_SAVE_SLOTS) {
    const raw = storage.getItem(worldSaveKey(fromId, slot));
    if (raw === null) storage.removeItem(worldSaveKey(toId, slot));
    else storage.setItem(worldSaveKey(toId, slot), raw);
  }
}

export function deleteWorldSaveSlots(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage || !worldId) return;
  for (const slot of WORLD_SAVE_SLOTS) storage.removeItem(worldSaveKey(worldId, slot));
}
