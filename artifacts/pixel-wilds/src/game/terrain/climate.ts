/**
 * Climate model: temperature falls with altitude, moisture varies regionally.
 * Those two fields pick the biome, and the biome picks the surface.
 */
import { SEA_LEVEL } from "../chunk";
import { valueNoise as vn } from "../noise";

export interface Climate {
  temperature: number;
  moisture: number;
}

export function climateAt(seed: number, x: number, z: number, ground: number): Climate {
  const base = 0.3 + 0.6 * (0.7 * vn(x - 31, z + 89, 500, seed + 22) + 0.3 * vn(x + 9, z - 4, 170, seed + 23));
  // Air cools with altitude (the "lapse rate"), so high ground gets cold.
  const temperature = base - Math.max(0, ground - SEA_LEVEL) / 170;
  const moisture = 0.7 * vn(x + 70, z - 46, 300, seed + 7) + 0.3 * vn(x - 5, z + 60, 110, seed + 8);
  return { temperature, moisture };
}
