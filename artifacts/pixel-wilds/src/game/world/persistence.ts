/**
 * World persistence.
 *
 * Two layers live here:
 *
 * 1. The v3 single-world API (`saveWorld`, `loadWorld`, `listSavedWorldSeeds`)
 *    is kept unchanged so existing saves and tests keep working.
 * 2. The v4 world registry: profiles keyed by a stable world id, one data
 *    snapshot per id, and a one-time migration of the old seed-keyed save.
 *
 * Storage is injected everywhere. That is what lets the registry run in tests
 * with no browser and lets a future backend replace localStorage without
 * touching the menu or the game shell.
 */
import { isWorldBlockType, type WorldBlockType } from "../blocks";
import { CHUNK_SIZE, WORLD_HEIGHT } from "../chunk";
import {
  LEGACY_PLAYER_SAVE_KEY,
  PLAYER_SAVE_PREFIX,
  SURVIVAL_SAVE_PREFIX,
  WORLD_DATA_PREFIX,
  WORLD_REGISTRY_KEY,
  browserStorage,
  type KeyValueStorage,
} from "../storage";
import {
  createWorldProfile,
  isValidSeed,
  isValidWorldProfile,
  normalizeWorldName,
  type WorldProfile,
} from "./profile";
import { createWorld, ensureChunks } from "./streaming";
import { getChunkCoordinates, parseBlockKey, type WorldData } from "./types";

export { browserStorage };
export type { KeyValueStorage };

const STORAGE_KEY = "pixel-wilds-world-v3";
const ACTIVE_WORLD_KEY = `${STORAGE_KEY}:active`;
const worldStorageKey = (seed: number) => `${STORAGE_KEY}:seed:${seed}`;

interface StoredRegistry {
  version: 1;
  activeId: string | null;
  worlds: WorldProfile[];
}

interface StoredWorldData {
  version: 1;
  seed: number;
  edits: WorldData["edits"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidStoredSeed(value: unknown): value is number {
  return isValidSeed(value);
}

/* ------------------------------------------------------------------ */
/* Legacy v3 API                                                        */
/* ------------------------------------------------------------------ */

export function listSavedWorldSeeds(storage: KeyValueStorage | null = browserStorage()): number[] {
  if (!storage) return [];
  const seeds = new Set<number>();
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(`${STORAGE_KEY}:seed:`)) continue;
      const seed = Number(key.slice(`${STORAGE_KEY}:seed:`.length));
      if (isValidStoredSeed(seed)) seeds.add(seed);
    }
    const active = Number(storage.getItem(ACTIVE_WORLD_KEY));
    if (Number.isSafeInteger(active) && active >= 0 && storage.getItem(worldStorageKey(active))) seeds.add(active);
    const legacy = storage.getItem(STORAGE_KEY);
    if (legacy) {
      try {
        const parsed: unknown = JSON.parse(legacy);
        if (isRecord(parsed) && isValidStoredSeed(parsed.seed)) seeds.add(parsed.seed);
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
  if (!storage || !isValidStoredSeed(seed)) return;
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
    storage.removeItem(WORLD_REGISTRY_KEY);
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
  const validRequestedSeed = isValidStoredSeed(requestedSeed);
  if (storage) {
    try {
      const activeSeed = requestedSeed ?? Number(storage.getItem(ACTIVE_WORLD_KEY));
      const saved = isValidStoredSeed(activeSeed)
        ? storage.getItem(worldStorageKey(activeSeed)) ?? (requestedSeed === undefined ? storage.getItem(STORAGE_KEY) : null)
        : requestedSeed === undefined ? storage.getItem(STORAGE_KEY) : null;
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (isRecord(parsed) && isValidStoredSeed(parsed.seed) && (!validRequestedSeed || parsed.seed === requestedSeed)) {
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

/* ------------------------------------------------------------------ */
/* Registry                                                             */
/* ------------------------------------------------------------------ */

function readRegistry(storage: KeyValueStorage): StoredRegistry | null {
  const raw = storage.getItem(WORLD_REGISTRY_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.worlds)) return null;
    const worlds = parsed.worlds.filter(isValidWorldProfile);
    const requestedActive = typeof parsed.activeId === "string" ? parsed.activeId : null;
    const activeId = worlds.some((world) => world.id === requestedActive)
      ? requestedActive
      : worlds[0]?.id ?? null;
    return { version: 1, activeId, worlds };
  } catch (error) {
    console.warn("The world registry is unreadable; rebuilding it from old saves.", error);
    return null;
  }
}

function writeRegistry(registry: StoredRegistry, storage: KeyValueStorage): void {
  storage.setItem(WORLD_REGISTRY_KEY, JSON.stringify(registry));
}

/**
 * Converts the pre-registry save into a profile plus per-id data. The old keys
 * are intentionally left in place: migration must never destroy a save it has
 * not successfully copied.
 */
function migrateLegacyWorlds(storage: KeyValueStorage): StoredRegistry {
  const now = Date.now();
  const seeds = listSavedWorldSeeds(storage);
  const activeSeed = Number(storage.getItem(ACTIVE_WORLD_KEY));
  const hasActive = seeds.includes(activeSeed);
  const worlds: WorldProfile[] = [];

  seeds.forEach((seed, index) => {
    const id = `legacy-${seed}`;
    const legacyRaw = storage.getItem(worldStorageKey(seed));
    if (legacyRaw) {
      try {
        const parsed: unknown = JSON.parse(legacyRaw);
        if (isRecord(parsed) && parsed.seed === seed) {
          const snapshot: StoredWorldData = {
            version: 1,
            seed,
            edits: readEdits(parsed.edits),
          };
          storage.setItem(`${WORLD_DATA_PREFIX}${id}`, JSON.stringify(snapshot));
        }
      } catch {
        // Keep the original slot; a fresh world will be generated on load.
      }
    }
    worlds.push(
      createWorldProfile({
        id,
        name: seed === activeSeed ? "My Wilderness" : `Wilderness ${seed}`,
        seed,
        mode: "creative",
        difficulty: "normal",
        rules: { structures: false, cheats: false, lan: false },
        createdAt: now - (seeds.length - index) * 1_000,
        lastPlayedAt: seed === activeSeed ? now : now - (seeds.length - index) * 60_000,
        legacySeed: seed === activeSeed ? seed : undefined,
      }),
    );
  });

  const activeId =
    (hasActive ? worlds.find((world) => world.legacySeed === activeSeed)?.id : undefined) ??
    worlds[0]?.id ??
    null;

  // Carry the single pre-registry player save into the world that was active.
  const legacyPlayer = storage.getItem(LEGACY_PLAYER_SAVE_KEY);
  const migrationTarget = worlds.find((world) => world.legacySeed !== undefined) ?? worlds[0];
  if (legacyPlayer && migrationTarget) {
    const targetKey = `${PLAYER_SAVE_PREFIX}${migrationTarget.id}`;
    if (storage.getItem(targetKey) === null) storage.setItem(targetKey, legacyPlayer);
  }

  const registry: StoredRegistry = { version: 1, activeId, worlds };
  writeRegistry(registry, storage);
  return registry;
}

function requireRegistry(storage: KeyValueStorage): StoredRegistry {
  return readRegistry(storage) ?? migrateLegacyWorlds(storage);
}

/** All worlds, most recently played first. Runs the one-time migration. */
export function listWorldProfiles(storage: KeyValueStorage | null = browserStorage()): WorldProfile[] {
  if (!storage) return [];
  try {
    const registry = requireRegistry(storage);
    return [...registry.worlds].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  } catch (error) {
    console.warn("Saved worlds could not be listed.", error);
    return [];
  }
}

export function getWorldProfile(
  id: string,
  storage: KeyValueStorage | null = browserStorage(),
): WorldProfile | null {
  if (!storage || !id) return null;
  return requireRegistry(storage).worlds.find((world) => world.id === id) ?? null;
}

export function getActiveWorldProfile(
  storage: KeyValueStorage | null = browserStorage(),
): WorldProfile | null {
  if (!storage) return null;
  const registry = requireRegistry(storage);
  return registry.worlds.find((world) => world.id === registry.activeId) ?? null;
}

export function saveWorldProfile(
  profile: WorldProfile,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage) throw new Error("Browser storage is unavailable, so the world cannot be saved.");
  if (!isValidWorldProfile(profile)) throw new Error("Refusing to save an invalid world profile.");
  const registry = requireRegistry(storage);
  const existing = registry.worlds.findIndex((world) => world.id === profile.id);
  const worlds = [...registry.worlds];
  if (existing >= 0) worlds[existing] = profile;
  else worlds.push(profile);
  writeRegistry({ ...registry, worlds }, storage);
}

export function setActiveWorldProfile(
  id: string | null,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage) return;
  const registry = requireRegistry(storage);
  const activeId = id && registry.worlds.some((world) => world.id === id) ? id : null;
  writeRegistry({ ...registry, activeId }, storage);
}

export function renameWorldProfile(
  id: string,
  name: string,
  storage: KeyValueStorage | null = browserStorage(),
): WorldProfile | null {
  const profile = getWorldProfile(id, storage);
  if (!profile || !storage) return null;
  const renamed: WorldProfile = { ...profile, name: normalizeWorldName(name) };
  saveWorldProfile(renamed, storage);
  return renamed;
}

export function touchWorldProfile(
  id: string,
  storage: KeyValueStorage | null = browserStorage(),
  now = Date.now(),
): WorldProfile | null {
  const profile = getWorldProfile(id, storage);
  if (!profile || !storage) return null;
  const touched: WorldProfile = { ...profile, lastPlayedAt: now };
  saveWorldProfile(touched, storage);
  setActiveWorldProfile(id, storage);
  return touched;
}

export function duplicateWorldProfile(
  id: string,
  storage: KeyValueStorage | null = browserStorage(),
  options: { name?: string; now?: number } = {},
): WorldProfile | null {
  const source = getWorldProfile(id, storage);
  if (!source || !storage) return null;
  const now = options.now ?? Date.now();
  const copy = createWorldProfile({
    ...source,
    id: undefined,
    name: options.name ?? `${source.name} copy`,
    createdAt: now,
    lastPlayedAt: now,
    legacySeed: undefined,
  });
  copyWorldData(id, copy.id, storage);
  saveWorldProfile(copy, storage);
  return copy;
}

export function deleteWorldProfile(
  id: string,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const registry = requireRegistry(storage);
  const profile = registry.worlds.find((world) => world.id === id);
  if (!profile) return false;
  const worlds = registry.worlds.filter((world) => world.id !== id);
  const activeId = registry.activeId === id ? worlds[0]?.id ?? null : registry.activeId;
  writeRegistry({ version: 1, activeId, worlds }, storage);
  storage.removeItem(`${WORLD_DATA_PREFIX}${id}`);
  storage.removeItem(`${PLAYER_SAVE_PREFIX}${id}`);
  storage.removeItem(`${SURVIVAL_SAVE_PREFIX}${id}`);
  if (profile.legacySeed !== undefined) deleteSavedWorld(profile.legacySeed, storage);
  return true;
}

/* ------------------------------------------------------------------ */
/* Per-world data                                                       */
/* ------------------------------------------------------------------ */

export function saveWorldData(
  worldId: string,
  world: WorldData,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage) throw new Error("Browser storage is unavailable, so the world cannot be saved.");
  if (!worldId) throw new Error("A world needs an id before its data can be saved.");
  if (!isValidStoredSeed(world.seed)) throw new Error("Refusing to save a world with an invalid seed.");
  const snapshot: StoredWorldData = { version: 1, seed: world.seed, edits: world.edits };
  storage.setItem(`${WORLD_DATA_PREFIX}${worldId}`, JSON.stringify(snapshot));
}

/** Loads (or generates and saves) the terrain snapshot belonging to one world. */
export function loadWorldData(
  worldId: string,
  seed: number,
  centerX = 0,
  centerZ = 0,
  radius = 3,
  storage: KeyValueStorage | null = browserStorage(),
): WorldData {
  const center = getChunkCoordinates(centerX, centerZ);
  if (storage) {
    try {
      const raw = storage.getItem(`${WORLD_DATA_PREFIX}${worldId}`);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isRecord(parsed) && isValidStoredSeed(parsed.seed)) {
          const world: WorldData = {
            seed: parsed.seed,
            chunks: {},
            edits: readEdits(parsed.edits),
          };
          return ensureChunks(world, center.x, center.z, radius);
        }
      }
    } catch (error) {
      console.warn("This world's save could not be read; generating it again.", error);
    }
  }
  const world = createWorld(seed, centerX, centerZ, radius);
  try {
    saveWorldData(worldId, world, storage);
  } catch (error) {
    console.warn("The new world could not be saved in this browser.", error);
  }
  return world;
}

export function copyWorldData(
  fromId: string,
  toId: string,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage || !fromId || !toId || fromId === toId) return;
  const raw = storage.getItem(`${WORLD_DATA_PREFIX}${fromId}`);
  if (raw !== null) storage.setItem(`${WORLD_DATA_PREFIX}${toId}`, raw);
}

export function hasWorldData(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  return Boolean(storage?.getItem(`${WORLD_DATA_PREFIX}${worldId}`));
}
