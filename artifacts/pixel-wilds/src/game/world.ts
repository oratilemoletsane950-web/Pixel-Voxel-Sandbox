export const BLOCK_TYPES = [
  "grass",
  "dirt",
  "stone",
  "sand",
  "wood",
  "leaves",
  "flower",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export interface BlockCell {
  x: number;
  y: number;
  z: number;
  type: BlockType;
}

export interface WorldData {
  seed: number;
  blocks: Record<string, BlockType>;
}

const WORLD_RADIUS = 40;
const MAX_BUILD_HEIGHT = 32;
const STORAGE_KEY = "pixel-wilds-world-v1";
const BLOCK_TYPE_SET = new Set<string>(BLOCK_TYPES);

export function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function parseBlockKey(key: string): BlockCell | null {
  const parts = key.split(",");
  if (parts.length !== 3) return null;

  const [x, y, z] = parts.map(Number);
  if (![x, y, z].every(Number.isInteger)) return null;
  return { x, y, z, type: "grass" };
}

function hash2(x: number, z: number, seed: number): number {
  let value = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(x: number, z: number, scale: number, seed: number): number {
  const x0 = Math.floor(x / scale);
  const z0 = Math.floor(z / scale);
  const fx = smoothstep((x / scale) - x0);
  const fz = smoothstep((z / scale) - z0);
  const top = hash2(x0, z0, seed) * (1 - fx) + hash2(x0 + 1, z0, seed) * fx;
  const bottom = hash2(x0, z0 + 1, seed) * (1 - fx) + hash2(x0 + 1, z0 + 1, seed) * fx;
  return top * (1 - fz) + bottom * fz;
}

export function getTerrainHeight(x: number, z: number, seed: number): number {
  const broad = valueNoise(x, z, 20, seed) * 0.55;
  const rolling = valueNoise(x, z, 9, seed + 91) * 0.3;
  const fine = valueNoise(x, z, 4, seed + 177) * 0.15;
  return 3 + Math.floor((broad + rolling + fine) * 7);
}

export function createWorld(seed = Math.floor(Math.random() * 2_147_000_000)): WorldData {
  const world: WorldData = { seed, blocks: {} };

  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 1) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 1) {
      const height = getTerrainHeight(x, z, seed);
      const dryRegion = valueNoise(x + 70, z - 46, 25, seed + 7) > 0.72;
      const rockyRegion = valueNoise(x - 31, z + 89, 14, seed + 22) > 0.76;

      for (let y = 0; y <= height; y += 1) {
        const surface = y === height;
        const upperSoil = y >= height - 2;
        const type: BlockType = surface
          ? dryRegion
            ? "sand"
            : rockyRegion
              ? "stone"
              : "grass"
          : upperSoil
            ? "dirt"
            : "stone";
        world.blocks[blockKey(x, y, z)] = type;
      }

      const topType = world.blocks[blockKey(x, height, z)];
      const roll = hash2(x, z, seed + 819);

      if (
        topType === "grass" &&
        roll > 0.989 &&
        Math.abs(x) + Math.abs(z) > 7
      ) {
        const treeHeight = 3 + Math.floor(hash2(x, z, seed + 2801) * 3);
        for (let y = height + 1; y < height + treeHeight + 1; y += 1) {
          world.blocks[blockKey(x, y, z)] = "wood";
        }
        const crown = height + treeHeight;
        for (let dx = -2; dx <= 2; dx += 1) {
          for (let dz = -2; dz <= 2; dz += 1) {
            for (let dy = -1; dy <= 2; dy += 1) {
              if (Math.abs(dx) + Math.abs(dz) + Math.max(0, dy) > 5) continue;
              if (dx === 0 && dz === 0 && dy <= 0) continue;
              const leafKey = blockKey(x + dx, crown + dy, z + dz);
              if (!world.blocks[leafKey]) world.blocks[leafKey] = "leaves";
            }
          }
        }
      } else if (topType === "grass" && roll > 0.965) {
        world.blocks[blockKey(x, height + 1, z)] = "flower";
      }
    }
  }

  return world;
}

export function getBlock(
  world: WorldData,
  x: number,
  y: number,
  z: number,
): BlockType | null {
  return world.blocks[blockKey(x, y, z)] ?? null;
}

export function setBlock(
  world: WorldData,
  x: number,
  y: number,
  z: number,
  type: BlockType | null,
): WorldData {
  if (y < 0 || y > MAX_BUILD_HEIGHT) return world;
  const key = blockKey(x, y, z);

  if (type === null) {
    if (!world.blocks[key]) return world;
    const blocks = { ...world.blocks };
    delete blocks[key];
    return { seed: world.seed, blocks };
  }

  if (world.blocks[key] === type) return world;
  return { seed: world.seed, blocks: { ...world.blocks, [key]: type } };
}

export function getVisibleBlocks(world: WorldData): BlockCell[] {
  const visible: BlockCell[] = [];

  for (const [key, type] of Object.entries(world.blocks)) {
    const cell = parseBlockKey(key);
    if (!cell) continue;
    const { x, y, z } = cell;

    if (
      !world.blocks[blockKey(x + 1, y, z)] ||
      !world.blocks[blockKey(x - 1, y, z)] ||
      !world.blocks[blockKey(x, y + 1, z)] ||
      !world.blocks[blockKey(x, y - 1, z)] ||
      !world.blocks[blockKey(x, y, z + 1)] ||
      !world.blocks[blockKey(x, y, z - 1)]
    ) {
      visible.push({ x, y, z, type });
    }
  }

  return visible;
}

export function saveWorld(world: WorldData): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(world));
}

export function loadWorld(): WorldData {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "seed" in parsed &&
        typeof parsed.seed === "number" &&
        Number.isSafeInteger(parsed.seed) &&
        "blocks" in parsed &&
        parsed.blocks !== null &&
        typeof parsed.blocks === "object" &&
        !Array.isArray(parsed.blocks)
      ) {
        const blocks: Record<string, BlockType> = {};
        for (const [key, type] of Object.entries(parsed.blocks)) {
          if (parseBlockKey(key) && typeof type === "string" && BLOCK_TYPE_SET.has(type)) {
            blocks[key] = type as BlockType;
          }
        }
        return { seed: parsed.seed, blocks };
      }
    }
  } catch (error) {
    console.warn("Saved world could not be read; creating a new world.", error);
  }

  const world = createWorld();
  saveWorld(world);
  return world;
}
