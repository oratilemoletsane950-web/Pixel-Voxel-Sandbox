/**
 * World time and daylight.
 *
 * Time is a pure, wrapped number of seconds. A full cycle is twelve real
 * minutes, starting at 08:00, which keeps a session readable without making
 * players wait through a real night. The renderer asks for a palette; it never
 * decides when dawn is.
 */
import {
  WORLD_CLOCK_PREFIX,
  browserStorage,
  type KeyValueStorage,
} from "../storage";

export const DAY_LENGTH_SECONDS = 12 * 60;
/** 08:00: the first light is already useful when a world opens. */
export const START_TIME = DAY_LENGTH_SECONDS * (8 / 24);

export function normalizeWorldTime(seconds: number): number {
  if (!Number.isFinite(seconds)) return START_TIME;
  const wrapped = seconds % DAY_LENGTH_SECONDS;
  return wrapped < 0 ? wrapped + DAY_LENGTH_SECONDS : wrapped;
}

export function advanceWorldTime(seconds: number, deltaSeconds: number): number {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return normalizeWorldTime(seconds);
  return normalizeWorldTime(seconds + deltaSeconds);
}

export function dayFraction(seconds: number): number {
  return normalizeWorldTime(seconds) / DAY_LENGTH_SECONDS;
}

/** Height of the sun in [-1, 1]; 0 at dawn/dusk, 1 at noon. */
export function sunHeight(seconds: number): number {
  return Math.sin(Math.PI * 2 * (dayFraction(seconds) - 0.25));
}

/** A smooth 0..1 light level, dark for most of the night and full at noon. */
export function daylight(seconds: number): number {
  const height = sunHeight(seconds);
  const t = Math.min(1, Math.max(0, (height + 0.08) / 0.28));
  return t * t * (3 - 2 * t);
}

export type DayPhase = "night" | "dawn" | "day" | "dusk";

export function dayPhase(seconds: number): DayPhase {
  const fraction = dayFraction(seconds);
  if (fraction < 0.22 || fraction >= 0.82) return "night";
  if (fraction < 0.3) return "dawn";
  if (fraction < 0.72) return "day";
  return "dusk";
}

export function phaseLabel(seconds: number): string {
  const phase = dayPhase(seconds);
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

/** 24-hour clock text, e.g. "08:00". */
export function formatWorldTime(seconds: number): string {
  const totalMinutes = Math.floor((normalizeWorldTime(seconds) / DAY_LENGTH_SECONDS) * 24 * 60);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export interface SkyPalette {
  sky: string;
  fog: string;
  sun: string;
  ambient: string;
  ground: string;
  /** Directional light intensity, in the renderer's existing range. */
  light: number;
}

interface PaletteKey extends SkyPalette {
  at: number;
}

const PALETTE_KEYS: readonly PaletteKey[] = [
  { at: 0, sky: "#101f2a", fog: "#263b43", sun: "#a9bccb", ambient: "#425766", ground: "#172324", light: 0.16 },
  { at: 0.22, sky: "#101f2a", fog: "#263b43", sun: "#a9bccb", ambient: "#425766", ground: "#172324", light: 0.16 },
  { at: 0.28, sky: "#d58b72", fog: "#cb9d88", sun: "#ffc98c", ambient: "#e9b995", ground: "#4f4e3d", light: 0.7 },
  { at: 0.36, sky: "#a9d9d1", fog: "#b7ddd0", sun: "#ffe3a4", ambient: "#f9e9ba", ground: "#567558", light: 1.9 },
  { at: 0.68, sky: "#a9d9d1", fog: "#b7ddd0", sun: "#ffe3a4", ambient: "#f9e9ba", ground: "#567558", light: 2.05 },
  { at: 0.76, sky: "#bd7467", fog: "#c7957e", sun: "#ffad72", ambient: "#e8b28c", ground: "#4b4a3b", light: 0.62 },
  { at: 0.82, sky: "#101f2a", fog: "#263b43", sun: "#a9bccb", ambient: "#425766", ground: "#172324", light: 0.16 },
  { at: 1, sky: "#101f2a", fog: "#263b43", sun: "#a9bccb", ambient: "#425766", ground: "#172324", light: 0.16 },
];

function parseHex(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixColor(from: string, to: string, amount: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  return `#${a
    .map((channel, index) => Math.round(channel + (b[index] - channel) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Interpolates the sky and lighting keyframes for one moment in the cycle. */
export function skyPalette(seconds: number): SkyPalette {
  const fraction = dayFraction(seconds);
  let left = PALETTE_KEYS[0];
  let right = PALETTE_KEYS[PALETTE_KEYS.length - 1];
  for (let index = 0; index < PALETTE_KEYS.length - 1; index += 1) {
    const candidate = PALETTE_KEYS[index];
    const next = PALETTE_KEYS[index + 1];
    if (fraction >= candidate.at && fraction <= next.at) {
      left = candidate;
      right = next;
      break;
    }
  }
  const span = right.at - left.at || 1;
  const t = Math.min(1, Math.max(0, (fraction - left.at) / span));
  return {
    sky: mixColor(left.sky, right.sky, t),
    fog: mixColor(left.fog, right.fog, t),
    sun: mixColor(left.sun, right.sun, t),
    ambient: mixColor(left.ambient, right.ambient, t),
    ground: mixColor(left.ground, right.ground, t),
    light: left.light + (right.light - left.light) * t,
  };
}

export function readWorldClock(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): number | null {
  if (!storage || !worldId) return null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`${WORLD_CLOCK_PREFIX}${worldId}`) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    const seconds = Number((parsed as { seconds?: unknown }).seconds);
    return Number.isFinite(seconds) ? normalizeWorldTime(seconds) : null;
  } catch {
    return null;
  }
}

export function saveWorldClock(
  worldId: string,
  seconds: number,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  if (!storage || !worldId) return false;
  try {
    storage.setItem(
      `${WORLD_CLOCK_PREFIX}${worldId}`,
      JSON.stringify({ version: 1, seconds: normalizeWorldTime(seconds) }),
    );
    return true;
  } catch {
    return false;
  }
}

export function deleteWorldClock(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (!storage || !worldId) return;
  storage.removeItem(`${WORLD_CLOCK_PREFIX}${worldId}`);
}
