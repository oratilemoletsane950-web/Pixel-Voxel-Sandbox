/**
 * Survival state: health, hunger, breath and the small forage loop.
 *
 * The model is deliberately headless. Renderers report *what happened* (landed
 * hard, head underwater, kept moving) and this module decides what it costs.
 * That keeps difficulty tuning, death and persistence testable without React,
 * Three.js or a browser.
 */
import {
  SURVIVAL_SAVE_PREFIX,
  browserStorage,
  type KeyValueStorage,
} from "../storage";
import type { Difficulty } from "../world/profile";

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const MAX_AIR = 15;
export const MAX_BERRIES = 99;
export const BERRIES_PER_HANDFUL = 6;

/** Falling faster than this (blocks/s) starts to hurt. */
export const FALL_DAMAGE_SPEED = 8;

export type DamageCause = "fall" | "drowning" | "starvation" | "void";

/** The renderer observes the world; the survival model judges it. */
export interface SurvivalEnvironment {
  /** The player's eyes are inside water. */
  underwater: boolean;
  /** The player's body is in water, even if their head is above the surface. */
  inWater: boolean;
  moving: boolean;
  sprinting: boolean;
}

export interface SurvivalState {
  health: number;
  hunger: number;
  air: number;
  berries: number;
  alive: boolean;
  /** Set only when a fatal hazard lands. */
  cause: DamageCause | null;
  /** Internal second counters, reset on respawn and never persisted. */
  starveClock: number;
  drownClock: number;
  regenClock: number;
}

interface DifficultyTuning {
  /** Hunger points lost per second while idle. */
  hungerDrain: number;
  starvationDamage: number;
  starvationInterval: number;
  drowningDamage: number;
  drowningInterval: number;
  fallMultiplier: number;
}

/**
 * Peaceful still allows falls and drowning, but hunger never empties. Easy is
 * gentle enough to learn in; hard makes the same mistakes consequential.
 */
export const SURVIVAL_TUNING: Record<Difficulty, DifficultyTuning> = {
  peaceful: {
    hungerDrain: 0,
    starvationDamage: 0,
    starvationInterval: 1,
    drowningDamage: 1,
    drowningInterval: 2.5,
    fallMultiplier: 0.5,
  },
  easy: {
    hungerDrain: 0.01,
    starvationDamage: 1,
    starvationInterval: 6,
    drowningDamage: 1,
    drowningInterval: 2,
    fallMultiplier: 0.7,
  },
  normal: {
    hungerDrain: 0.02,
    starvationDamage: 1,
    starvationInterval: 4,
    drowningDamage: 2,
    drowningInterval: 1.5,
    fallMultiplier: 1,
  },
  hard: {
    hungerDrain: 0.032,
    starvationDamage: 2,
    starvationInterval: 3,
    drowningDamage: 3,
    drowningInterval: 1,
    fallMultiplier: 1.35,
  },
};

const BERRY_SOURCES = new Set(["leaves", "birch_leaves", "spruce_leaves"]);

export function isBerrySource(block: string): boolean {
  return BERRY_SOURCES.has(block);
}

export function createSurvivalState(): SurvivalState {
  return {
    health: MAX_HEALTH,
    hunger: MAX_HUNGER,
    air: MAX_AIR,
    berries: 0,
    alive: true,
    cause: null,
    starveClock: 0,
    drownClock: 0,
    regenClock: 0,
  };
}

/** Restores after death, keeping foraged berries but not injuries or breath. */
export function respawnSurvival(previous: SurvivalState): SurvivalState {
  return { ...createSurvivalState(), berries: previous.berries };
}

export function addBerries(state: SurvivalState, count = 1): SurvivalState {
  if (!state.alive || count <= 0) return state;
  return { ...state, berries: Math.min(MAX_BERRIES, state.berries + Math.floor(count)) };
}

export function canEat(state: SurvivalState): boolean {
  return state.alive && state.berries > 0 && state.hunger < MAX_HUNGER;
}

/** One handful restores three hunger pips (six points). */
export function eatBerries(state: SurvivalState): SurvivalState {
  if (!canEat(state)) return state;
  return {
    ...state,
    berries: state.berries - 1,
    hunger: Math.min(MAX_HUNGER, state.hunger + BERRIES_PER_HANDFUL),
  };
}

/** Converts a landing speed into health points, rounded so every fall matters. */
export function fallDamage(impactSpeed: number, difficulty: Difficulty): number {
  if (!Number.isFinite(impactSpeed) || impactSpeed <= FALL_DAMAGE_SPEED) return 0;
  const tuning = SURVIVAL_TUNING[difficulty];
  return Math.max(
    1,
    Math.min(
      MAX_HEALTH,
      Math.round((impactSpeed - FALL_DAMAGE_SPEED) * 0.85 * tuning.fallMultiplier),
    ),
  );
}

export function applyDamage(
  state: SurvivalState,
  amount: number,
  cause: DamageCause,
): SurvivalState {
  if (!state.alive || !Number.isFinite(amount) || amount <= 0) return state;
  const health = Math.max(0, state.health - amount);
  return {
    ...state,
    health,
    alive: health > 0,
    cause: health > 0 ? state.cause : cause,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Advances hunger, breath, starvation, drowning and passive regeneration.
 *
 * `deltaSeconds` is clamped to one second so a background tab that resumes
 * after a long pause cannot delete a whole health bar in one frame.
 */
export function tickSurvival(
  state: SurvivalState,
  environment: SurvivalEnvironment,
  difficulty: Difficulty,
  deltaSeconds: number,
): SurvivalState {
  if (!state.alive) return state;
  const dt = clamp(deltaSeconds, 0, 1);
  if (!dt) return state;
  const tuning = SURVIVAL_TUNING[difficulty];
  const activity = environment.sprinting ? 2.2 : environment.moving ? 1.45 : 1;

  let next: SurvivalState = {
    ...state,
    hunger: clamp(state.hunger - tuning.hungerDrain * activity * dt, 0, MAX_HUNGER),
  };

  // Breath only drains while the eyes are under. Surfacing refills quickly.
  const air = environment.underwater
    ? Math.max(0, state.air - dt)
    : Math.min(MAX_AIR, state.air + dt * 4);

  next = { ...next, air };

  if (environment.underwater && air <= 0) {
    const drowned = state.drownClock + dt;
    const damageTicks = Math.floor(drowned / tuning.drowningInterval);
    for (let tick = 0; tick < damageTicks; tick += 1) {
      next = applyDamage(next, tuning.drowningDamage, "drowning");
    }
    next.drownClock = drowned % tuning.drowningInterval;
    next.regenClock = 0;
    return next;
  }

  next.drownClock = 0;

  if (next.hunger <= 0 && tuning.starvationDamage > 0) {
    const starved = state.starveClock + dt;
    const damageTicks = Math.floor(starved / tuning.starvationInterval);
    for (let tick = 0; tick < damageTicks; tick += 1) {
      next = applyDamage(next, tuning.starvationDamage, "starvation");
    }
    next.starveClock = starved % tuning.starvationInterval;
    next.regenClock = 0;
    return next;
  }

  next.starveClock = 0;

  // A well-fed player slowly recovers, spending a little hunger to do so.
  if (next.hunger >= 18 && next.health < MAX_HEALTH) {
    const regenerated = state.regenClock + dt;
    if (regenerated >= 4) {
      next = {
        ...next,
        health: Math.min(MAX_HEALTH, next.health + 1),
        hunger: Math.max(0, next.hunger - 0.5),
      };
      next.regenClock = regenerated - 4;
    } else {
      next.regenClock = regenerated;
    }
  } else {
    next.regenClock = 0;
  }

  return next;
}

interface StoredSurvival {
  version: 1;
  health: number;
  hunger: number;
  berries: number;
}

/** Reads a saved vitals snapshot, rejecting malformed or dead-on-load values. */
export function readSurvivalSave(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): SurvivalState | null {
  if (!storage || !worldId) return null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`${SURVIVAL_SAVE_PREFIX}${worldId}`) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Partial<StoredSurvival>;
    const health = Number(record.health);
    const hunger = Number(record.hunger);
    const berries = Number(record.berries);
    if (!Number.isFinite(health) || health <= 0) return null;
    return {
      ...createSurvivalState(),
      health: clamp(Math.round(health), 1, MAX_HEALTH),
      hunger: clamp(Number.isFinite(hunger) ? hunger : MAX_HUNGER, 0, MAX_HUNGER),
      berries: clamp(Number.isFinite(berries) ? Math.floor(berries) : 0, 0, MAX_BERRIES),
    };
  } catch {
    return null;
  }
}

export function saveSurvival(
  worldId: string,
  state: SurvivalState,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  if (!storage || !worldId) return false;
  const snapshot: StoredSurvival = {
    version: 1,
    health: state.health,
    hunger: state.hunger,
    berries: state.berries,
  };
  try {
    storage.setItem(`${SURVIVAL_SAVE_PREFIX}${worldId}`, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function deleteSurvivalSave(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage || !worldId) return;
  storage.removeItem(`${SURVIVAL_SAVE_PREFIX}${worldId}`);
}
