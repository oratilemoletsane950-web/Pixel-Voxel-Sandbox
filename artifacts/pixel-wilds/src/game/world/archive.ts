/**
 * Portable world archives.
 *
 * An archive contains the profile and every per-world save slot as opaque,
 * already-validated strings. Import always creates a fresh identity and writes
 * the profile last, so a failed or malformed import can never leave a
 * half-visible world in the registry.
 */
import { browserStorage, type KeyValueStorage } from "../storage";
import {
  createWorldProfile,
  isValidWorldProfile,
  normalizeWorldName,
  type WorldProfile,
} from "./profile";
import { getWorldProfile, saveWorldProfile } from "./persistence";
import {
  WORLD_SAVE_SLOTS,
  deleteWorldSaveSlots,
  readWorldSaveSlots,
  writeWorldSaveSlots,
  type WorldSaveSlotMap,
} from "./save-slots";

export const WORLD_ARCHIVE_FORMAT = "pixel-wilds-world";
export const WORLD_ARCHIVE_VERSION = 1;
/** Large enough for explored worlds, small enough to fail before blocking a tab. */
export const MAX_WORLD_ARCHIVE_CHARACTERS = 12_000_000;

export interface WorldArchive {
  format: typeof WORLD_ARCHIVE_FORMAT;
  version: typeof WORLD_ARCHIVE_VERSION;
  exportedAt: string;
  profile: WorldProfile;
  saves: WorldSaveSlotMap;
}

export interface ImportWorldOptions {
  /** Override the display name; defaults to the exported name plus a suffix. */
  name?: string;
  now?: number;
}

export class WorldArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldArchiveError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertArchiveShape(value: unknown): asserts value is WorldArchive {
  if (!isRecord(value)) throw new WorldArchiveError("That file is not a Pixel Wilds archive.");
  if (value.format !== WORLD_ARCHIVE_FORMAT) {
    throw new WorldArchiveError("That file is not a Pixel Wilds archive.");
  }
  if (value.version !== WORLD_ARCHIVE_VERSION) {
    throw new WorldArchiveError("That world archive uses an unsupported version.");
  }
  if (!isValidWorldProfile(value.profile)) {
    throw new WorldArchiveError("That world archive has an invalid profile.");
  }
  if (!isRecord(value.saves)) {
    throw new WorldArchiveError("That world archive has no save data.");
  }
  for (const slot of WORLD_SAVE_SLOTS) {
    const raw = value.saves[slot.id];
    if (raw !== undefined && typeof raw !== "string") {
      throw new WorldArchiveError(`That world archive has an invalid ${slot.label} save.`);
    }
  }
}

/** Builds an archive from the current registry and save slots. */
export function createWorldArchive(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): WorldArchive | null {
  if (!storage || !worldId) return null;
  const profile = getWorldProfile(worldId, storage);
  if (!profile) return null;
  return {
    format: WORLD_ARCHIVE_FORMAT,
    version: WORLD_ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    profile,
    saves: readWorldSaveSlots(worldId, storage),
  };
}

export function serializeWorldArchive(archive: WorldArchive): string {
  return JSON.stringify(archive, null, 2);
}

/**
 * Validates an archive and installs it under a new id.
 *
 * Terrain is the one slot whose internal seed must match the profile. Other
 * readers already sanitise malformed values, so a partially damaged inventory
 * cannot escape into another world.
 */
export function importWorldArchive(
  serialized: string,
  storage: KeyValueStorage | null = browserStorage(),
  options: ImportWorldOptions = {},
): WorldProfile {
  if (!storage) throw new WorldArchiveError("Browser storage is unavailable.");
  if (typeof serialized !== "string" || !serialized.trim()) {
    throw new WorldArchiveError("That file is empty.");
  }
  if (serialized.length > MAX_WORLD_ARCHIVE_CHARACTERS) {
    throw new WorldArchiveError("That world archive is too large to import.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new WorldArchiveError("That file is not valid JSON.");
  }
  assertArchiveShape(parsed);

  const source = parsed.profile;
  if (parsed.saves.data) {
    try {
      const terrain = JSON.parse(parsed.saves.data);
      if (!isRecord(terrain) || terrain.seed !== source.seed) {
        throw new WorldArchiveError("That archive's terrain does not match its world seed.");
      }
    } catch (error) {
      if (error instanceof WorldArchiveError) throw error;
      throw new WorldArchiveError("That archive's terrain data is unreadable.");
    }
  }

  const imported = createWorldProfile({
    name: options.name ?? normalizeWorldName(`${source.name} (imported)`),
    seed: source.seed,
    mode: source.mode,
    difficulty: source.difficulty,
    rules: source.rules,
    now: options.now,
  });

  try {
    writeWorldSaveSlots(imported.id, parsed.saves, storage);
    saveWorldProfile(imported, storage);
    return imported;
  } catch (error) {
    // The profile is written last, so removing the new slots is enough to
    // leave no visible or orphaned world after a storage failure.
    deleteWorldSaveSlots(imported.id, storage);
    if (error instanceof WorldArchiveError) throw error;
    throw new WorldArchiveError("That world could not be written to browser storage.");
  }
}

