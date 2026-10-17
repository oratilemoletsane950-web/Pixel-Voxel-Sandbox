/**
 * Deterministic hash + value-noise helpers shared by terrain, trees, ores and
 * settlements. Everything is a pure function of (x, z, seed) so any chunk can
 * be generated on its own, in any order, and always match its neighbours.
 */

export function hash2(x: number, z: number, seed: number): number {
  let value =
    Math.imul(x | 0, 374761393) +
    Math.imul(z | 0, 668265263) +
    Math.imul(seed | 0, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

/** Three-input hash, used for ore veins and other volumetric features. */
export function hash3(x: number, y: number, z: number, seed: number): number {
  return hash2(x + Math.imul(y | 0, 40503), z - Math.imul(y | 0, 9973), seed + (y | 0) * 31);
}

export function smoothstep(value: number): number {
  const t = value < 0 ? 0 : value > 1 ? 1 : value;
  return t * t * (3 - 2 * t);
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smooth bilinear value noise in [0, 1]; `scale` is the feature size in blocks. */
export function valueNoise(x: number, z: number, scale: number, seed: number): number {
  const gx = x / scale;
  const gz = z / scale;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const fx = smoothstep(gx - x0);
  const fz = smoothstep(gz - z0);
  const top = hash2(x0, z0, seed) * (1 - fx) + hash2(x0 + 1, z0, seed) * fx;
  const bottom = hash2(x0, z0 + 1, seed) * (1 - fx) + hash2(x0 + 1, z0 + 1, seed) * fx;
  return top * (1 - fz) + bottom * fz;
}

/** Numeric key for an (x, z) column so caches avoid building strings. */
export function columnKey(x: number, z: number): string {
  // String keys remain collision-free at large positive or negative world
  // coordinates; the former packed-number key collided outside its fixed range.
  return `${x},${z}`;
}
