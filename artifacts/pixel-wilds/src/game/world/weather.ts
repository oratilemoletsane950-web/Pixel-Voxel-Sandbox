/**
 * Deterministic weather episodes.
 *
 * Weather is a pure function of the world seed and the persisted world clock,
 * so every client sees the same sky without an extra save slot. Cold biomes
 * turn rain into snow; storms are wet and darker in both renderers.
 */
export type WeatherKind = "clear" | "rain" | "snow" | "storm";

export interface WeatherState {
  kind: WeatherKind;
  label: string;
  intensity: number;
  /** Rain, snow and storms darken and thicken the atmosphere. */
  wet: boolean;
}

export const WEATHER_PERIOD = 180;

const COLD_BIOMES = new Set([
  "tundra",
  "alpine",
  "alpine_meadow",
  "alpine_forest",
  "boreal_forest",
  "taiga",
]);

const LABELS: Record<WeatherKind, string> = {
  clear: "Clear skies",
  rain: "Rain",
  snow: "Snow",
  storm: "Storm",
};

function hash(seed: number, episode: number, salt: number): number {
  const value = Math.sin(seed * 0.017 + episode * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function isColdBiome(biome: string): boolean {
  return COLD_BIOMES.has(biome);
}

/** Weather for the current in-game second. */
export function weatherAt(seed: number, seconds: number, cold = false): WeatherState {
  const episode = Math.floor(Math.max(0, seconds) / WEATHER_PERIOD);
  const roll = hash(seed, episode, 1);
  let kind: WeatherKind;
  if (roll < 0.54) kind = "clear";
  else if (roll < 0.82) kind = cold ? "snow" : "rain";
  else if (roll < 0.93) kind = "storm";
  else kind = cold ? "snow" : "rain";

  const intensity = kind === "clear" ? 0.15 : 0.45 + hash(seed, episode, 2) * 0.55;
  return {
    kind,
    label: LABELS[kind],
    intensity,
    wet: kind !== "clear",
  };
}
