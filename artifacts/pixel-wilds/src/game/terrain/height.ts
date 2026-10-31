/**
 * Elevation and hydrology model (1 block = 0.5 m).
 *
 *  - Elevation is built from broad landforms (a few hundred blocks wide), a
 *    ridged mountain mask, and fine relief of a few blocks.
 *  - Rivers follow a warped iso-line of low-frequency noise. Their water level
 *    is flat across the channel and follows the smoothed land surface along
 *    it, they only run through low ground, and they carve a valley with banks.
 *  - Anything below SEA_LEVEL fills with water, which gives lakes and seas.
 *
 * Pure and cache-free: `Terrain` owns the memoisation, so this model can be
 * sampled by tools and tests without a world.
 */
import { MAX_BUILD_HEIGHT, SEA_LEVEL } from "../chunk";
import { lerp, smoothstep, valueNoise as vn } from "../noise";
import type { HeightRecord } from "./types";

interface RiverHit {
  dist: number;
  half: number;
  bank: number;
  depth: number;
  ratio: number;
}

export class HeightModel {
  constructor(readonly seed: number) {}

  private riverField(x: number, z: number, net: number): number {
    const s = this.seed + net * 977;
    const wx = x + (vn(x, z, 70, s + 1021) - 0.5) * 48 + (vn(x * 2, z * 2, 35, s + 1025) - 0.5) * 24;
    const wz = z + (vn(x + 500, z - 300, 70, s + 1031) - 0.5) * 48 + (vn(x * 2, z * 2, 35, s + 1033) - 0.5) * 24;
    const wide = net === 0;
    return (
      0.5 * vn(wx + 140, wz - 90, wide ? 280 : 140, s + 1001) +
      0.3 * vn(wx - 37, wz + 120, wide ? 100 : 52, s + 1007) +
      0.2 * vn(wx + 11, wz + 5, wide ? 40 : 22, s + 1013)
    );
  }

  private riverHit(x: number, z: number, net: number, broad: number): RiverHit | null {
    const n0 = this.riverField(x, z, net);
    const offset = Math.abs(n0 - 0.5);
    if (offset > 0.12) return null;
    const gx = (this.riverField(x + 3, z, net) - n0) / 3;
    const gz = (this.riverField(x, z + 3, net) - n0) / 3;
    const gradient = Math.max(Math.hypot(gx, gz), 0.0012);
    const dist = offset / gradient;

    // Rivers are widest and deepest on low ground and thin out into streams
    // and then disappear as the land climbs.
    const low = 1 - smoothstep((broad - SEA_LEVEL) / 60);
    const fade = 1 - smoothstep((broad - 68) / 16);
    const wide = net === 0;
    // A regional wetness mask leaves some areas river-free (drier plains,
    // building land) and confines tributaries to the wettest regions.
    const wet = vn(x + 90, z - 210, 520, this.seed + 1111);
    const mask = smoothstep((wet - (wide ? 0.5 : 0.62)) / 0.12);
    const half = (wide ? 1.6 + 6 * low : 1 + 2.6 * low) * fade * mask;
    if (half < 0.6) return null;
    const bank = 4 + half * 0.9;
    if (dist >= half + bank) return null;
    const depth = wide ? 2 + Math.round(3 * low) : 1 + Math.round(1.5 * low);
    return { dist, half, bank, depth, ratio: dist / (half + bank) };
  }

  natural(x: number, z: number): HeightRecord {
    const s = this.seed;
    const lowland = 0.48 * vn(x, z, 320, s) + 0.34 * vn(x, z, 128, s + 91) + 0.18 * vn(x + 43, z - 67, 48, s + 95);
    const continental = vn(x + 300, z - 150, 700, s + 17);
    const mountainField = vn(x + 226, z - 134, 420, s + 503);
    const mountain = smoothstep((mountainField - 0.58) / 0.3);
    const ridge = 1 - Math.abs(2 * vn(x - 164, z + 86, 150, s + 509) - 1);

    const rise = Math.pow(mountain, 1.25) * (40 + ridge * 120);
    const broad = 24 + lowland * 48 + (continental - 0.5) * 20 + rise;
    const fine = (0.6 * vn(x, z, 36, s + 177) + 0.4 * vn(x, z, 14, s + 251) - 0.5) * 12;
    const rough = (vn(x, z, 20, s + 311) - 0.5) * 24 * mountain;
    const jagged = (vn(x, z, 12, s + 401) - 0.5) * 16 * Math.pow(mountain, 1.5);
    let natural = Math.round(broad + fine * (1 - 0.4 * mountain) + rough + jagged);
    natural = Math.max(4, Math.min(MAX_BUILD_HEIGHT - 32, natural));

    let ground = natural;
    let water = natural < SEA_LEVEL ? SEA_LEVEL : 0;
    let riverDist = Infinity;
    let riverHalf = 0;

    if (broad > SEA_LEVEL + 1 && broad < 86) {
      let best: RiverHit | null = null;
      for (let net = 0; net < 2; net += 1) {
        const hit = this.riverHit(x, z, net, broad);
        if (hit && (!best || hit.ratio < best.ratio)) best = hit;
      }
      if (best) {
        riverDist = best.dist;
        riverHalf = best.half;
        const level = Math.max(SEA_LEVEL, Math.floor(broad) - 3);
        if (best.dist <= best.half) {
          const t = best.dist / best.half;
          const bed = Math.round(level - best.depth * (1 - t * t));
          ground = Math.min(natural, bed);
          water = ground < level ? level : 0;
        } else {
          // Valley bank: ease from a rim one block above the water to natural ground.
          const t = smoothstep((best.dist - best.half) / best.bank);
          ground = Math.round(lerp(level + 1, natural, t));
          water = ground < SEA_LEVEL ? SEA_LEVEL : 0;
        }
      }
    }

    return { ground, water, riverDist, riverHalfWidth: riverHalf, broad, mountain };
  }
}
