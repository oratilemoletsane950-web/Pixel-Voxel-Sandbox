/**
 * World persistence.
 *
 * Storage is a small injectable interface rather than a direct
 * `window.localStorage` call, so save/load behaviour can be tested without a
 * browser and a future backend (IndexedDB, a file, a server) can be dropped in
 * without touching the world editors or the app.
 *
 * Save format:
 *   pixel-wilds-world-v3:active        -> the seed of the last played world
 *   pixel-wilds-world-v3:seed:<seed>   -> { seed, edits } for that world
 *   pixel-wilds-world-v3               -> legacy mirror for older builds
 */
import { isWorldBlockType, type WorldBlockType } from "../blocks";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../chunk";
import { createWorld, ensureChunks } from "./streaming";
import { getChunkCoordinates, parseBlockKey, type WorldData } from "./types";

const STORAGE_KEY = "pixel-wilds-world-v3";
const ACTIVE_WORLD_KEY = `${STORAGE_KEY}:active`;
const worldStorageKey = (seed: number) => `${STORAGE_KEY}:seed:${seed}`;
const MAX_SEED = 2_147_483_647;

export interface KeyValueStorage {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
}

/** The browser's localStorage, or null when storage is unavailable. */
export function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidSeed(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_SEED;
}

export function listSavedWorldSeeds(storage: KeyValueStorage | null = browserStorage()): number[] {
  if (!storage) return [];
  const seeds = new Set<number>();
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(`${STORAGE_KEY}:seed:`)) continue;
      const seed = Number(key.slice(`${STORAGE_KEY}:seed:`.length));
      if (isValidSeed(seed)) seeds.add(seed);
    }
    const active = Number(storage.getItem(ACTIVE_WORLD_KEY));
    if (Number.isSafeInteger(active) && active >= 0 && storage.getItem(worldStorageKey(active))) seeds.add(active);
    const legacy = storage.getItem(STORAGE_KEY);
    if (legacy) {
      try {
        const parsed: unknown = JSON.parse(legacy);
        if (isRecord(parsed) && isValidSeed(parsed.seed)) seeds.add(parsed.seed);
      } catch {
        // Ignore corrupt legacy metadata; individual slots remain usable.
      }
    }
  } catch {
    // Storage may be disabled; an empty list is safer than crashing the menu.
  }
  return [...seeds].sort((a, b) => a - b);
}

export function deleteSavedWorld(seed: number, storage: KeyValueStorage | null = browserStorage()): void {
  if (!storage || !isValidSeed(seed)) return;
  storage.removeItem(worldStorageKey(seed));
  if (Number(storage.getItem(ACTIVE_WORLD_KEY)) === seed) {
    storage.removeItem(ACTIVE_WORLD_KEY);
  }
  const legacy = storage.getItem(STORAGE_KEY);
  if (legacy) {
    try {
      const parsed: unknown = JSON.parse(legacy);
      if (isRecord(parsed) && parsed.seed === seed) storage.removeItem(STORAGE_KEY);
    } catch {
      storage.removeItem(STORAGE_KEY);
    }
  }
}

export function deleteAllSavedWorlds(storage: KeyValueStorage | null = browserStorage()): void {
  if (!storage) return;
  for (const seed of listSavedWorldSeeds(storage)) deleteSavedWorld(seed, storage);
  try {
    storage.removeItem(STORAGE_KEY);
    storage.removeItem(ACTIVE_WORLD_KEY);
  } catch {
    // The caller can report storage errors if the browser blocks writes.
  }
}

export function saveWorld(world: WorldData, storage: KeyValueStorage | null = browserStorage()): void {
  if (!storage) throw new Error("Browser storage is unavailable, so the world cannot be saved.");
  const serialized = JSON.stringify({ seed: world.seed, edits: world.edits });
  // Keep a separate save slot for each seed, plus a pointer to the active world.
  storage.setItem(worldStorageKey(world.seed), serialized);
  storage.setItem(ACTIVE_WORLD_KEY, String(world.seed));
  // Keep the legacy key readable for older builds.
  storage.setItem(STORAGE_KEY, serialized);
}

function readEdits(value: unknown): WorldData["edits"] {
  const result: WorldData["edits"] = {};
  if (!isRecord(value)) return result;
  for (const [chunk, raw] of Object.entries(value)) {
    const chunkParts = chunk.split(",").map(Number);
    if (
      chunkParts.length !== 2 ||
      !chunkParts.every(Number.isSafeInteger) ||
      !isRecord(raw)
    ) continue;
    const [cx, cz] = chunkParts as [number, number];
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;
    const entries: Record<string, WorldBlockType | null> = {};
    for (const [key, block] of Object.entries(raw)) {
      const cell = parseBlockKey(key);
      if (
        !cell ||
        cell.y < 0 ||
        cell.y >= WORLD_HEIGHT ||
        cell.x < startX ||
        cell.x >= startX + CHUNK_SIZE ||
        cell.z < startZ ||
        cell.z >= startZ + CHUNK_SIZE
      ) continue;
      if (block === null) entries[key] = null;
      else if (isWorldBlockType(block)) entries[key] = block;
    }
    if (Object.keys(entries).length > 0) result[chunk] = entries;
  }
  return result;
}

/**
 * Worlds saved by earlier versions (keys v1 / v2) used 1 m blocks and a
 * different terrain model, so they cannot be mapped onto the new 0.5 m world;
 * they are left untouched in storage and a fresh world is started.
 */
export function loadWorld(
  centerX = 0,
  centerZ = 0,
  radius = 3,
  requestedSeed?: number,
  storage: KeyValueStorage | null = browserStorage(),
): WorldData {
  const center = getChunkCoordinates(centerX, centerZ);
  const validRequestedSeed = isValidSeed(requestedSeed);
  if (storage) {
    try {
      const activeSeed = requestedSeed ?? Number(storage.getItem(ACTIVE_WORLD_KEY));
      const saved = isValidSeed(activeSeed)
        ? storage.getItem(worldStorageKey(activeSeed)) ?? (requestedSeed === undefined ? storage.getItem(STORAGE_KEY) : null)
        : requestedSeed === undefined ? storage.getItem(STORAGE_KEY) : null;
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (isRecord(parsed) && isValidSeed(parsed.seed) && (!validRequestedSeed || parsed.seed === requestedSeed)) {
          const world: WorldData = { seed: parsed.seed, chunks: {}, edits: readEdits(parsed.edits) };
          return ensureChunks(world, center.x, center.z, radius);
        }
      }
    } catch (error) {
      console.warn("Saved world could not be read; creating a new world.", error);
    }
  }
  // If a selected slot disappeared or is corrupt while the world menu is open,
  // preserve that requested seed instead of silently entering a different world.
  const world = createWorld(validRequestedSeed ? requestedSeed : undefined, centerX, centerZ, radius);
  try {
    saveWorld(world, storage);
  } catch (error) {
    console.warn("The new world could not be saved in this browser.", error);
  }
  return world;
}
