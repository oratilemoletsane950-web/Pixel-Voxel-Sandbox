/**
 * World profile: the metadata a world owns independently of its terrain.
 *
 * Profiles are validated at every boundary (creation, load, import) so a
 * corrupt registry entry can never reach the game shell or the generator.
 */
import { normalizeWorldSeed } from "../worldgen/seed";

export const GAME_MODES = ["creative", "survival"] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const DIFFICULTIES = ["peaceful", "easy", "normal", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Rules that future stages (structures, commands, LAN) read instead of branching on ids. */
export interface WorldRules {
  structures: boolean;
  cheats: boolean;
  lan: boolean;
}

export interface WorldProfile {
  /** Stable identity; save keys are derived from this, never from the seed. */
  id: string;
  name: string;
  seed: number;
  mode: GameMode;
  difficulty: Difficulty;
  rules: WorldRules;
  createdAt: number;
  lastPlayedAt: number;
  /** Set on worlds migrated from the old one-world-per-seed saves. */
  legacySeed?: number;
}

export interface CreateWorldProfileInput {
  name: string;
  seed: number;
  mode?: GameMode;
  difficulty?: Difficulty;
  rules?: Partial<WorldRules>;
  id?: string;
  now?: number;
  createdAt?: number;
  lastPlayedAt?: number;
  legacySeed?: number;
}

export const MAX_WORLD_NAME_LENGTH = 48;
export const MAX_SEED = 2_147_483_647;

export const DEFAULT_WORLD_RULES: WorldRules = Object.freeze({
  structures: false,
  cheats: false,
  lan: false,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === "string" && (GAME_MODES as readonly string[]).includes(value);
}

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && (DIFFICULTIES as readonly string[]).includes(value);
}

/** Seeds are user-facing, so anything outside the safe range is rejected loudly. */
export function isValidSeed(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_SEED
  );
}

export function normalizeWorldName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (!trimmed) return "Untitled Wilds";
  return trimmed.slice(0, MAX_WORLD_NAME_LENGTH);
}

/** Identity is independent of the seed so duplicated worlds can share terrain. */
export function createWorldId(seed: number, now = Date.now()): string {
  const randomUUID = globalThis.crypto?.randomUUID?.();
  if (randomUUID) return randomUUID;
  return `world-${seed.toString(36)}-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createWorldProfile(input: CreateWorldProfileInput): WorldProfile {
  const seed = normalizeWorldSeed(input.seed);
  const now = input.now ?? Date.now();
  const profile: WorldProfile = {
    id: input.id?.trim() || createWorldId(seed, now),
    name: normalizeWorldName(input.name),
    seed,
    mode: input.mode ?? "creative",
    difficulty: input.difficulty ?? "normal",
    rules: {
      structures: input.rules?.structures ?? DEFAULT_WORLD_RULES.structures,
      cheats: input.rules?.cheats ?? DEFAULT_WORLD_RULES.cheats,
      lan: input.rules?.lan ?? DEFAULT_WORLD_RULES.lan,
    },
    createdAt: input.createdAt ?? now,
    lastPlayedAt: input.lastPlayedAt ?? now,
  };
  if (input.legacySeed !== undefined && isValidSeed(input.legacySeed)) {
    profile.legacySeed = input.legacySeed;
  }
  return profile;
}

/** Used by the registry so malformed stored entries are dropped, not trusted. */
export function isValidWorldProfile(value: unknown): value is WorldProfile {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || !value.id.trim()) return false;
  if (typeof value.name !== "string" || !value.name.trim()) return false;
  if (!isValidSeed(value.seed)) return false;
  if (!isGameMode(value.mode) || !isDifficulty(value.difficulty)) return false;
  if (!isRecord(value.rules)) return false;
  if (
    typeof value.rules.structures !== "boolean" ||
    typeof value.rules.cheats !== "boolean" ||
    typeof value.rules.lan !== "boolean"
  ) {
    return false;
  }
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.lastPlayedAt)) return false;
  if (value.legacySeed !== undefined && !isValidSeed(value.legacySeed)) return false;
  return true;
}
