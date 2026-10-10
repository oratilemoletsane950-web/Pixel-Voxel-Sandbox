export const CHUNK_SIZE = 16;
export const CHUNK_LOAD_RADIUS = 2;
export const MAX_BUILD_HEIGHT = 64;
export const PLAYER_EYE_HEIGHT = 1.68;
export const PLAYER_HEIGHT = 1.8;

/** The ten blocks the player can select, place, and collect. */
export const BLOCK_TYPES = [
  "grass",
  "dirt",
  "stone",
  "sand",
  "wood",
  "leaves",
  "gravel",
  "clay",
  "snow",
  "cobblestone",
] as const;

/** Flowers are generated as scenery, but are not part of the build palette. */
export const WORLD_BLOCK_TYPES = [...BLOCK_TYPES, "flower"] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];
export type WorldBlockType = (typeof WORLD_BLOCK_TYPES)[number];

export interface BlockCell {
  x: number;
  y: number;
  z: number;
  type: WorldBlockType;
}

interface LegacyBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WorldData {
  seed: number;
  /** Only the currently loaded chunks live here. */
  chunks: Record<string, Record<string, WorldBlockType>>;
  /** Player changes, keyed first by chunk so streaming stays cheap. */
  edits: Record<string, Record<string, WorldBlockType | null>>;
  /** Original v1 terrain, retained so existing landscapes survive migration. */
  legacyChunks: Record<string, Record<string, WorldBlockType>>;
  legacyBounds: LegacyBounds | null;
}

interface BlockCoordinate {
  x: number;
  y: number;
  z: number;
}

const STORAGE_KEY = "pixel-wilds-world-v2";
const OLD_STORAGE_KEY = "pixel-wilds-world-v1";
const BLOCK_TYPE_SET = new Set<string>(WORLD_BLOCK_TYPES);

export function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function chunkKey(chunkX: number, chunkZ: number): string {
  return `${chunkX},${chunkZ}`;
}

function chunkKeyAt(x: number, z: number): string {
  return chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
}

export function getChunkCoordinates(x: number, z: number): { x: number; z: number } {
  return { x: Math.floor(x / CHUNK_SIZE), z: Math.floor(z / CHUNK_SIZE) };
}

export function parseBlockKey(key: string): BlockCoordinate | null {
  const parts = key.split(",");
  if (parts.length !== 3) return null;
  const [x, y, z] = parts.map(Number);
  if (![x, y, z].every(Number.isInteger)) return null;
  return { x, y, z };
}

function hash2(x: number, z: number, seed: number): number {
  let value =
    Math.imul(x, 374761393) +
    Math.imul(z, 668265263) +
    Math.imul(seed, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(x: number, z: number, scale: number, seed: number): number {
  const x0 = Math.floor(x / scale);
  const z0 = Math.floor(z / scale);
  const fx = smoothstep(x / scale - x0);
  const fz = smoothstep(z / scale - z0);
  const top = hash2(x0, z0, seed) * (1 - fx) + hash2(x0 + 1, z0, seed) * fx;
  const bottom =
    hash2(x0, z0 + 1, seed) * (1 - fx) + hash2(x0 + 1, z0 + 1, seed) * fx;
  return top * (1 - fz) + bottom * fz;
}

export function getTerrainHeight(x: number, z: number, seed: number): number {
  const broad = valueNoise(x, z, 27, seed) * 0.55;
  const rolling = valueNoise(x, z, 11, seed + 91) * 0.3;
  const fine = valueNoise(x, z, 4, seed + 177) * 0.15;
  return 3 + Math.floor((broad + rolling + fine) * 11);
}

function getTerrainProfile(x: number, z: number, seed: number) {
  const height = getTerrainHeight(x, z, seed);
  const moisture = valueNoise(x + 70, z - 46, 29, seed + 7);
  const temperature = valueNoise(x - 31, z + 89, 31, seed + 22);
  const geology = valueNoise(x + 51, z + 12, 13, seed + 211);
  const gravel = valueNoise(x - 83, z + 27, 10, seed + 419);
  const wetland = height <= 8 && moisture > 0.6;
  const desert = moisture < 0.3;
  const snowy = height >= 8 && temperature < 0.3;
  const rocky = height >= 10 || geology > 0.86;
  const gravelPatch = gravel > 0.86 && (desert || height >= 7);

  let surface: WorldBlockType = "grass";
  if (snowy) surface = "snow";
  else if (wetland) surface = "clay";
  else if (gravelPatch) surface = "gravel";
  else if (desert) surface = "sand";
  else if (rocky) surface = "cobblestone";

  return { height, moisture, desert, wetland, snowy, rocky, gravelPatch, surface };
}

function setChunkCell(
  blocks: Record<string, WorldBlockType>,
  x: number,
  y: number,
  z: number,
  type: WorldBlockType,
  chunkX: number,
  chunkZ: number,
): void {
  if (Math.floor(x / CHUNK_SIZE) !== chunkX || Math.floor(z / CHUNK_SIZE) !== chunkZ) return;
  blocks[blockKey(x, y, z)] = type;
}

function generateChunk(seed: number, chunkX: number, chunkZ: number): Record<string, WorldBlockType> {
  const blocks: Record<string, WorldBlockType> = {};
  const startX = chunkX * CHUNK_SIZE;
  const startZ = chunkZ * CHUNK_SIZE;

  for (let x = startX; x < startX + CHUNK_SIZE; x += 1) {
    for (let z = startZ; z < startZ + CHUNK_SIZE; z += 1) {
      const profile = getTerrainProfile(x, z, seed);
      for (let y = 0; y <= profile.height; y += 1) {
        let type: WorldBlockType = "stone";
        if (y === profile.height) {
          type = profile.surface;
        } else if (profile.surface === "sand") {
          type = y >= profile.height - 2
            ? profile.gravelPatch && y === profile.height - 2 ? "gravel" : "sand"
            : "stone";
        } else if (profile.surface === "clay") {
          type = y >= profile.height - 2 ? "clay" : "stone";
        } else if (profile.surface === "gravel") {
          type = y >= profile.height - 2 ? "gravel" : "stone";
        } else if (profile.surface === "snow") {
          type = y >= profile.height - 2 ? "dirt" : "stone";
        } else if (profile.surface === "cobblestone") {
          type = y >= profile.height - 1 ? "cobblestone" : "stone";
        } else {
          type = y >= profile.height - 2 ? "dirt" : "stone";
        }
        blocks[blockKey(x, y, z)] = type;
      }

      const flowerRoll = hash2(x, z, seed + 819);
      if (profile.surface === "grass" && flowerRoll > 0.972) {
        blocks[blockKey(x, profile.height + 1, z)] = "flower";
      }
    }
  }

  // Scan a two-block halo so tree crowns remain seamless across chunk borders.
  for (let x = startX - 2; x < startX + CHUNK_SIZE + 2; x += 1) {
    for (let z = startZ - 2; z < startZ + CHUNK_SIZE + 2; z += 1) {
      const profile = getTerrainProfile(x, z, seed);
      if (
        profile.surface !== "grass" ||
        Math.abs(x) + Math.abs(z) < 7 ||
        hash2(x, z, seed + 2801) < 0.991
      ) continue;

      const treeHeight = 3 + Math.floor(hash2(x, z, seed + 3791) * 3);
      for (let y = profile.height + 1; y <= profile.height + treeHeight; y += 1) {
        setChunkCell(blocks, x, y, z, "wood", chunkX, chunkZ);
      }
      const crown = profile.height + treeHeight;
      for (let dx = -2; dx <= 2; dx += 1) {
        for (let dz = -2; dz <= 2; dz += 1) {
          for (let dy = -1; dy <= 2; dy += 1) {
            if (Math.abs(dx) + Math.abs(dz) + Math.max(0, dy) > 5) continue;
            if (dx === 0 && dz === 0 && dy <= 0) continue;
            const key = blockKey(x + dx, crown + dy, z + dz);
            if (!blocks[key]) {
              setChunkCell(blocks, x + dx, crown + dy, z + dz, "leaves", chunkX, chunkZ);
            }
          }
        }
      }
    }
  }

  return blocks;
}

function makeLoadedChunk(
  world: WorldData,
  chunkX: number,
  chunkZ: number,
): Record<string, WorldBlockType> {
  const key = chunkKey(chunkX, chunkZ);
  const blocks = generateChunk(world.seed, chunkX, chunkZ);
  const legacy = world.legacyChunks[key];

  if (legacy && world.legacyBounds) {
    const startX = chunkX * CHUNK_SIZE;
    const startZ = chunkZ * CHUNK_SIZE;
    const minX = Math.max(startX, world.legacyBounds.minX);
    const maxX = Math.min(startX + CHUNK_SIZE - 1, world.legacyBounds.maxX);
    const minZ = Math.max(startZ, world.legacyBounds.minZ);
    const maxZ = Math.min(startZ + CHUNK_SIZE - 1, world.legacyBounds.maxZ);
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let y = 0; y <= MAX_BUILD_HEIGHT; y += 1) {
          delete blocks[blockKey(x, y, z)];
        }
      }
    }
    for (const [cellKey, type] of Object.entries(legacy)) {
      const cell = parseBlockKey(cellKey);
      if (
        cell &&
        cell.x >= minX && cell.x <= maxX &&
        cell.z >= minZ && cell.z <= maxZ
      ) {
        blocks[cellKey] = type;
      }
    }
  }

  for (const [cellKey, type] of Object.entries(world.edits[key] ?? {})) {
    if (type === null) delete blocks[cellKey];
    else blocks[cellKey] = type;
  }
  return blocks;
}

export function ensureChunks(
  world: WorldData,
  centerChunkX: number,
  centerChunkZ: number,
  radius = CHUNK_LOAD_RADIUS,
): WorldData {
  const needed = new Set<string>();
  for (let x = centerChunkX - radius; x <= centerChunkX + radius; x += 1) {
    for (let z = centerChunkZ - radius; z <= centerChunkZ + radius; z += 1) {
      needed.add(chunkKey(x, z));
    }
  }
  const loadedKeys = Object.keys(world.chunks);
  if (loadedKeys.length === needed.size && loadedKeys.every((key) => needed.has(key))) {
    return world;
  }

  const chunks: WorldData["chunks"] = {};
  for (const key of needed) {
    if (world.chunks[key]) {
      chunks[key] = world.chunks[key];
      continue;
    }
    const [chunkX, chunkZ] = key.split(",").map(Number);
    chunks[key] = makeLoadedChunk(world, chunkX, chunkZ);
  }
  return { ...world, chunks };
}

export function createWorld(
  seed = Math.floor(Math.random() * 2_147_000_000),
  centerX = 0,
  centerZ = 0,
): WorldData {
  const world: WorldData = { seed, chunks: {}, edits: {}, legacyChunks: {}, legacyBounds: null };
  const center = getChunkCoordinates(centerX, centerZ);
  return ensureChunks(world, center.x, center.z);
}

export function getBlock(
  world: WorldData,
  x: number,
  y: number,
  z: number,
): WorldBlockType | null {
  if (y < 0 || y > MAX_BUILD_HEIGHT) return null;
  return world.chunks[chunkKeyAt(x, z)]?.[blockKey(x, y, z)] ?? null;
}

export function setBlock(
  world: WorldData,
  x: number,
  y: number,
  z: number,
  type: WorldBlockType | null,
): WorldData {
  if (y < 0 || y > MAX_BUILD_HEIGHT) return world;
  const key = blockKey(x, y, z);
  const currentChunkKey = chunkKeyAt(x, z);
  const currentChunk = world.chunks[currentChunkKey] ??
    makeLoadedChunk(world, Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
  if (currentChunk[key] === type || (!currentChunk[key] && type === null)) return world;

  const blocks = { ...currentChunk };
  if (type === null) delete blocks[key];
  else blocks[key] = type;
  return {
    ...world,
    chunks: { ...world.chunks, [currentChunkKey]: blocks },
    edits: {
      ...world.edits,
      [currentChunkKey]: { ...(world.edits[currentChunkKey] ?? {}), [key]: type },
    },
  };
}

export function getVisibleBlocks(world: WorldData): BlockCell[] {
  const visible: BlockCell[] = [];
  for (const chunk of Object.values(world.chunks)) {
    for (const [key, type] of Object.entries(chunk)) {
      const cell = parseBlockKey(key);
      if (!cell) continue;
      const { x, y, z } = cell;
      if (
        !getBlock(world, x + 1, y, z) ||
        !getBlock(world, x - 1, y, z) ||
        !getBlock(world, x, y + 1, z) ||
        !getBlock(world, x, y - 1, z) ||
        !getBlock(world, x, y, z + 1) ||
        !getBlock(world, x, y, z - 1)
      ) {
        visible.push({ x, y, z, type });
      }
    }
  }
  return visible;
}

export function getLoadedBlockCount(world: WorldData): number {
  return Object.values(world.chunks).reduce((total, chunk) => total + Object.keys(chunk).length, 0);
}

export function getLoadedChunkCount(world: WorldData): number {
  return Object.keys(world.chunks).length;
}

export function saveWorld(world: WorldData): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      seed: world.seed,
      edits: world.edits,
      legacyChunks: world.legacyChunks,
      legacyBounds: world.legacyBounds,
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readChunkMap(
  value: unknown,
  allowNull: boolean,
): Record<string, Record<string, WorldBlockType | null>> {
  const result: Record<string, Record<string, WorldBlockType | null>> = {};
  if (!isRecord(value)) return result;
  for (const [chunk, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const entries: Record<string, WorldBlockType | null> = {};
    for (const [key, block] of Object.entries(raw)) {
      const cell = parseBlockKey(key);
      if (!cell || chunkKeyAt(cell.x, cell.z) !== chunk) continue;
      if (allowNull && block === null) entries[key] = null;
      else if (typeof block === "string" && BLOCK_TYPE_SET.has(block)) {
        entries[key] = block as WorldBlockType;
      }
    }
    result[chunk] = entries;
  }
  return result;
}

function loadVersionTwo(parsed: unknown): WorldData | null {
  if (!isRecord(parsed) || !Number.isSafeInteger(parsed.seed)) return null;
  const edits = readChunkMap(parsed.edits, true);
  const legacyChunks = readChunkMap(parsed.legacyChunks, false) as Record<
    string,
    Record<string, WorldBlockType>
  >;
  let legacyBounds: LegacyBounds | null = null;
  if (
    isRecord(parsed.legacyBounds) &&
    Number.isInteger(parsed.legacyBounds.minX) &&
    Number.isInteger(parsed.legacyBounds.maxX) &&
    Number.isInteger(parsed.legacyBounds.minZ) &&
    Number.isInteger(parsed.legacyBounds.maxZ)
  ) {
    legacyBounds = {
      minX: parsed.legacyBounds.minX as number,
      maxX: parsed.legacyBounds.maxX as number,
      minZ: parsed.legacyBounds.minZ as number,
      maxZ: parsed.legacyBounds.maxZ as number,
    };
  }
  return {
    seed: parsed.seed as number,
    chunks: {},
    edits: edits as WorldData["edits"],
    legacyChunks,
    legacyBounds,
  };
}

function migrateVersionOne(parsed: unknown): WorldData | null {
  if (!isRecord(parsed) || !Number.isSafeInteger(parsed.seed) || !isRecord(parsed.blocks)) return null;
  const legacyChunks: WorldData["legacyChunks"] = {};
  for (const [key, type] of Object.entries(parsed.blocks)) {
    const cell = parseBlockKey(key);
    if (!cell || typeof type !== "string" || !BLOCK_TYPE_SET.has(type)) continue;
    const keyForChunk = chunkKeyAt(cell.x, cell.z);
    (legacyChunks[keyForChunk] ??= {})[key] = type as WorldBlockType;
  }
  return {
    seed: parsed.seed as number,
    chunks: {},
    edits: {},
    legacyChunks,
    legacyBounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 },
  };
}

export function loadWorld(centerX = 0, centerZ = 0): WorldData {
  const center = getChunkCoordinates(centerX, centerZ);
  try {
    const currentSave = window.localStorage.getItem(STORAGE_KEY);
    if (currentSave) {
      const world = loadVersionTwo(JSON.parse(currentSave));
      if (world) return ensureChunks(world, center.x, center.z);
    }

    const oldSave = window.localStorage.getItem(OLD_STORAGE_KEY);
    if (oldSave) {
      const world = migrateVersionOne(JSON.parse(oldSave));
      if (world) return ensureChunks(world, center.x, center.z);
    }
  } catch (error) {
    console.warn("Saved world could not be read; creating a new world.", error);
  }

  const world = createWorld(undefined, centerX, centerZ);
  try {
    saveWorld(world);
  } catch (error) {
    console.warn("The new world could not be saved in this browser.", error);
  }
  return world;
}
