/**
 * Reads the world around the player to decide how exposed they are.
 *
 * Keeping this pure and outside the renderer means both the WebGL and fallback
 * views report identical weather exposure, and survival tests can use a tiny
 * synthetic world instead of a camera.
 */
import { isSolidAt } from "./access";
import type { Position } from "../physics";
import type { WorldData } from "./types";
import type { WeatherState } from "./weather";

export interface WeatherExposure {
  /** 0 clear, up to 1 in the heaviest storm. */
  precipitation: number;
  /** A solid roof is overhead, so rain and wind are blocked. */
  sheltered: boolean;
  /** 0 mild, 1 freezing. */
  ambientCold: number;
}

export function hasRoof(world: WorldData, position: Position): boolean {
  const x = Math.floor(position.x);
  const z = Math.floor(position.z);
  const start = Math.floor(position.y) + 1;
  for (let y = start; y <= start + 20; y += 1) {
    if (isSolidAt(world, x, y, z)) return true;
  }
  return false;
}

export function weatherExposure(
  world: WorldData,
  position: Position,
  weather: WeatherState,
  coldBiome = false,
): WeatherExposure {
  const sheltered = hasRoof(world, position);
  const precipitation = weather.wet ? weather.intensity : 0;
  const base = coldBiome || weather.kind === "snow" ? 0.78 : 0.14;
  const wind = weather.kind === "storm" ? 0.2 : weather.kind === "rain" ? 0.08 : 0;
  return {
    precipitation,
    sheltered,
    ambientCold: Math.min(1, base + wind + (sheltered ? -0.18 : 0)),
  };
}
