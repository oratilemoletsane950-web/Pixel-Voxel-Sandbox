/**
 * Application settings, shared by every world.
 *
 * The shape is intentionally small and additive: new options get a default,
 * a clamp and a field here, without the menu or the game shell growing a
 * separate loading path for each one.
 */
import { browserStorage, SETTINGS_KEY, type KeyValueStorage } from "./storage";
import {
  DEFAULT_RENDER_RADIUS,
  MAX_RENDER_RADIUS,
  MIN_RENDER_RADIUS,
} from "./world/types";

export interface AppSettings {
  renderRadius: number;
  fov: number;
  /** Touch-drag look multiplier; 1 is the original feel. */
  touchSensitivity: number;
}

export const MIN_FOV = 60;
export const MAX_FOV = 100;
export const MIN_TOUCH_SENSITIVITY = 0.5;
export const MAX_TOUCH_SENSITIVITY = 2;
export const DEFAULT_SETTINGS: AppSettings = Object.freeze({
  renderRadius: DEFAULT_RENDER_RADIUS,
  fov: 74,
  touchSensitivity: 1,
});

/** Pre-settings key, kept so existing view-distance choices survive. */
const LEGACY_RENDER_RADIUS_KEY = "pixel-wilds-render-radius";

function clampInteger(value: unknown, min: number, max: number): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number);
  if (rounded < min || rounded > max) return null;
  return rounded;
}

export function normalizeSettings(value: unknown): AppSettings {
  const record = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const renderRadius =
    clampInteger(record.renderRadius, MIN_RENDER_RADIUS, MAX_RENDER_RADIUS) ??
    DEFAULT_SETTINGS.renderRadius;
  const fov = clampInteger(record.fov, MIN_FOV, MAX_FOV) ?? DEFAULT_SETTINGS.fov;
  const touch = Number(record.touchSensitivity);
  const touchSensitivity = Number.isFinite(touch)
    ? Math.min(MAX_TOUCH_SENSITIVITY, Math.max(MIN_TOUCH_SENSITIVITY, Math.round(touch * 10) / 10))
    : DEFAULT_SETTINGS.touchSensitivity;
  return { renderRadius, fov, touchSensitivity };
}

export function readSettings(storage: KeyValueStorage | null = browserStorage()): AppSettings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (raw) {
      const settings = normalizeSettings(JSON.parse(raw));
      return settings;
    }
    const legacyRadius = clampInteger(
      storage.getItem(LEGACY_RENDER_RADIUS_KEY),
      MIN_RENDER_RADIUS,
      MAX_RENDER_RADIUS,
    );
    if (legacyRadius !== null) {
      return { ...DEFAULT_SETTINGS, renderRadius: legacyRadius };
    }
  } catch {
    // Corrupt settings fall back to defaults rather than blocking launch.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(
  settings: AppSettings,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const normalized = normalizeSettings(settings);
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    storage.setItem(LEGACY_RENDER_RADIUS_KEY, String(normalized.renderRadius));
    return true;
  } catch {
    return false;
  }
}
