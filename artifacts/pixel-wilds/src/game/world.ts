import {
  AIR,
  BLOCK_ID,
  BLOCK_NAME_BY_ID,
  BLOCK_TYPES,
  ID,
  IS_SOLID,
  WORLD_BLOCK_TYPES,
  isWorldBlockType,
  type BlockType,
  type WorldBlockType,
} from "./blocks";
import {
  CHUNK_SIZE,
  ChunkWriter,
  MAX_BUILD_HEIGHT,
  WORLD_HEIGHT,
  chunkIndex,
  chunkKey,
  createChunk,
  recountChunk,
  type Chunk,
} from "./chunk";
import { hash2 } from "./noise";
import {
  getNearbySettlements,
  settlementGround,
  stampSettlements,
  type Settlement,
} from "./settlements";
import { Terrain, type Biome } from "./terrain";
import { hasFlower, placeVegetation } from "./trees";

export { BLOCK_TYPES, WORLD_BLOCK_TYPES, CHUNK_SIZE, MAX_BUILD_HEIGHT };
export type { BlockType, WorldBlockType };

/** Scale: 1 block = 0.5 m, so the 2 m player is 4 blocks tall. */
export const PLAYER_HEIGHT = 4;
export const PLAYER_EYE_HEIGHT = 3.7;
export const DEFAULT_RENDER_RADIUS = 8;
export const MIN_RENDER_RADIUS = 4;
export const MAX_RENDER_RADIUS = 14;

export interface BlockCell {
  x: number;
  y: number;
  z: number;
  type: WorldBlockType;
}

export interface WorldData {
  seed: number;
  /** Only the currently loaded chunks live here. */
  chunks: Record<string, Chunk>;
  /** Player changes, keyed first by chunk so they re-apply when a chunk streams back in. */
  edits: Record<string, Record<string, WorldBlockType | null>>;
}

const STORAGE_KEY = "pixel-wilds-world-v3";

export function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function getChunkCoordinates(x: number, z: number): { x: number; z: number } {
  return { x: Math.floor(x / CHUNK_SIZE), z: Math.floor(z / CHUNK_SIZE) };
}

export function parseBlockKey(key: string): { x: number; y: number; z: number } | null {
  const parts = key.split(",");
  if (parts.length !== 3) return null;
  const [x, y, z] = parts.map(Number);
  if (![x, y, z].every(Number.isInteger)) return null;
  return { x, y, z };
}

/* ------------------------------------------------------------------ */
/* Terrain registry                                                    */
/* ------------------------------------------------------------------ */

const terrains = new Map<number, Terrain>();

export function getTerrain(seed: number): Terrain {
  let terrain = terrains.get(seed);
  if (!terrain) {
    terrain = new Terrain(seed);
    const self = terrain;
    terrain.hook = (x, z, natural) => settlementGround(self, x, z, natural);
    if (terrains.size >= 2) {
      const oldest = terrains.keys().next().value;
      if (oldest !== undefined) terrains.delete(oldest);
    }
    terrains.set(seed, terrain);
  }
  return terrain;
}

export function getSettlementsNear(seed: number, x: number, z: number, radius: number): Settlement[] {
  return getNearbySettlements(getTerrain(seed), x, z, radius);
}

export function getBiomeAt(seed: number, x: number, z: number): Biome {
  return getTerrain(seed).column(Math.floor(x), Math.floor(z)).biome;
}

/* ------------------------------------------------------------------ */
/* Chunk generation                                                    */
/* ------------------------------------------------------------------ */

const ROCKS = new Set<number>([ID.stone, ID.granite, ID.limestone, ID.sandstone]);

/**
 * Ore veins are small random walks inside stone. Coal is common in
 * shallow-to-mid depths, iron is rarer and deeper, and granite country holds
 * more iron. Each vein is confined to one chunk so the result never depends
 * on load order.
 */
function placeOres(writer: ChunkWriter, terrain: Terrain, seed: number): void {
  const { chunk } = writer;
  const kinds = [
    { id: ID.coal_ore, veins: 9, minY: 10, maxDepthBelowSurface: 5, size: 9 },
    { id: ID.iron_ore, veins: 5, minY: 4, maxDepthBelowSurface: 12, size: 6 },
  ];
  kinds.forEach((kind, kindIndex) => {
    for (let vein = 0; vein < kind.veins; vein += 1) {
      const r = (n: number) => hash2(chunk.cx * 131 + vein * 7 + n, chunk.cz * 137 + kindIndex * 11 + n * 3, seed + 7777);
      const lx = 2 + Math.floor(r(1) * 12);
      const lz = 2 + Math.floor(r(2) * 12);
      const column = terrain.column(writer.startX + lx, writer.startZ + lz);
      const maxY = column.ground - kind.maxDepthBelowSurface;
      if (maxY <= kind.minY) continue;
      if (kind.id === ID.iron_ore && column.rock !== ID.granite && r(9) > 0.5) continue;
      let x = lx;
      let y = kind.minY + Math.floor(r(3) * (maxY - kind.minY));
      let z = lz;
      const size = kind.size + Math.floor(r(4) * 5);
      for (let step = 0; step < size; step += 1) {
        const index = chunkIndex(x, y, z);
        if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE && y > 0 && y < WORLD_HEIGHT && ROCKS.has(chunk.blocks[index])) {
          chunk.blocks[index] = kind.id;
        }
        const dir = Math.floor(r(10 + step) * 6);
        if (dir === 0) x += 1;
        else if (dir === 1) x -= 1;
        else if (dir === 2) z += 1;
        else if (dir === 3) z -= 1;
        else if (dir === 4) y += 1;
        else y -= 1;
      }
    }
  });
}

function generateChunk(terrain: Terrain, cx: number, cz: number): Chunk {
  const seed = terrain.seed;
  const chunk = createChunk(cx, cz);
  const writer = new ChunkWriter(chunk);
  const { blocks } = chunk;

  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      const x = writer.startX + lx;
      const z = writer.startZ + lz;
      const column = terrain.column(x, z);
      const base = (lx * CHUNK_SIZE + lz) * WORLD_HEIGHT;
      const { ground } = column;

      blocks[base] = ID.bedrock;
      for (let y = 1; y <= ground; y += 1) {
        const depth = ground - y;
        let id: number;
        if (y === 1 && hash2(x, z, seed + 5) < 0.5) id = ID.bedrock; // rough bedrock floor
        else if (depth === 0) id = column.top;
        else if (depth <= column.soilDepth) id = column.soil;
        else if (depth <= column.soilDepth + column.midDepth) id = column.mid || column.rock;
        else id = column.rock;
        blocks[base + y] = id;
      }
      if (column.water > ground) {
        for (let y = ground + 1; y <= column.water; y += 1) {
          // Surface water freezes in cold climates (colder than taiga).
          blocks[base + y] = column.temperature < 0.36 && y === column.water ? ID.ice : ID.water;
        }
      } else if (hasFlower(column, x, z, seed)) {
        blocks[base + ground + 1] = ID.flower;
      }
    }
  }

  placeOres(writer, terrain, seed);
  placeVegetation(writer, terrain, seed);
  stampSettlements(writer, terrain, seed);
  recountChunk(chunk);
  return chunk;
}

function applyEdits(world: WorldData, chunk: Chunk): void {
  const edits = world.edits[chunkKey(chunk.cx, chunk.cz)];
  if (!edits) return;
  const startX = chunk.cx * CHUNK_SIZE;
  const startZ = chunk.cz * CHUNK_SIZE;
  for (const [key, type] of Object.entries(edits)) {
    const cell = parseBlockKey(key);
    if (!cell || cell.y < 0 || cell.y >= WORLD_HEIGHT) continue;
    chunk.blocks[chunkIndex(cell.x - startX, cell.y, cell.z - startZ)] = type === null ? AIR : BLOCK_ID[type];
  }
  recountChunk(chunk);
}

/**
 * Streams chunks around the player. At most `maxNew` chunks are generated per
 * call (nearest first) so a long walk never causes one big hitch; the caller
 * keeps calling until the returned world stops changing.
 */
export function ensureChunks(
  world: WorldData,
  centerChunkX: number,
  centerChunkZ: number,
  radius = DEFAULT_RENDER_RADIUS,
  maxNew = Infinity,
): WorldData {
  const terrain = getTerrain(world.seed);
  const missing: Array<{ x: number; z: number; d: number }> = [];
  for (let x = centerChunkX - radius; x <= centerChunkX + radius; x += 1) {
    for (let z = centerChunkZ - radius; z <= centerChunkZ + radius; z += 1) {
      if (world.chunks[chunkKey(x, z)]) continue;
      const dx = x - centerChunkX;
      const dz = z - centerChunkZ;
      if (dx * dx + dz * dz > (radius + 0.5) * (radius + 0.5)) continue; // round, not square
      missing.push({ x, z, d: dx * dx + dz * dz });
    }
  }
  missing.sort((a, b) => a.d - b.d);

  const keepRadius = radius + 2;
  let drop: string[] = [];
  for (const [key, chunk] of Object.entries(world.chunks)) {
    if (Math.abs(chunk.cx - centerChunkX) > keepRadius || Math.abs(chunk.cz - centerChunkZ) > keepRadius) {
      drop.push(key);
    }
  }
  if (missing.length === 0 && drop.length === 0) return world;

  const chunks = { ...world.chunks };
  for (const key of drop) delete chunks[key];
  drop = [];
  for (const entry of missing.slice(0, maxNew)) {
    const chunk = generateChunk(terrain, entry.x, entry.z);
    applyEdits(world, chunk);
    chunks[chunkKey(entry.x, entry.z)] = chunk;
  }
  return { ...world, chunks };
}

export function isWorldComplete(world: WorldData, cx: number, cz: number, radius: number): boolean {
  for (let x = cx - radius; x <= cx + radius; x += 1) {
    for (let z = cz - radius; z <= cz + radius; z += 1) {
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz > (radius + 0.5) * (radius + 0.5)) continue;
      if (!world.chunks[chunkKey(x, z)]) return false;
    }
  }
  return true;
}

export function createWorld(
  seed = Math.floor(Math.random() * 2_147_000_000),
  centerX = 0,
  centerZ = 0,
  radius = 3,
): WorldData {
  const world: WorldData = { seed, chunks: {}, edits: {} };
  const center = getChunkCoordinates(centerX, centerZ);
  return ensureChunks(world, center.x, center.z, radius);
}

/* ------------------------------------------------------------------ */
/* Block access                                                        */
/* ------------------------------------------------------------------ */

export function getChunk(world: WorldData, x: number, z: number): Chunk | undefined {
  return world.chunks[chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE))];
}

export function getBlockId(world: WorldData, x: number, y: number, z: number): number {
  if (y < 0 || y > MAX_BUILD_HEIGHT) return 0;
  const chunk = getChunk(world, x, z);
  if (!chunk) return 0;
  const lx = x - chunk.cx * CHUNK_SIZE;
  const lz = z - chunk.cz * CHUNK_SIZE;
  return chunk.blocks[chunkIndex(lx, y, lz)];
}

export function getBlock(world: WorldData, x: number, y: number, z: number): WorldBlockType | null {
  return BLOCK_NAME_BY_ID[getBlockId(world, x, y, z)] ?? null;
}

export function isSolidAt(world: WorldData, x: number, y: number, z: number): boolean {
  return IS_SOLID[getBlockId(world, x, y, z)] === 1;
}

export function isChunkLoadedAt(world: WorldData, x: number, z: number): boolean {
  return getChunk(world, x, z) !== undefined;
}

/**
 * Changes one block. The chunk is edited in place (cheap: no copying of the
 * 49k-entry array) and its version is bumped so only that chunk, and its
 * neighbours when the edit is on a border, rebuild their meshes.
 */
export function setBlock(
  world: WorldData,
  x: number,
  y: number,
  z: number,
  type: WorldBlockType | null,
): WorldData {
  if (y < 0 || y > MAX_BUILD_HEIGHT) return world;
  const chunk = getChunk(world, x, z);
  if (!chunk) return world;
  const lx = x - chunk.cx * CHUNK_SIZE;
  const lz = z - chunk.cz * CHUNK_SIZE;
  const index = chunkIndex(lx, y, lz);
  const next = type === null ? AIR : BLOCK_ID[type];
  const previous = chunk.blocks[index];
  if (previous === next) return world;

  chunk.blocks[index] = next;
  chunk.version += 1;
  chunk.solidCount += (next !== AIR ? 1 : 0) - (previous !== AIR ? 1 : 0);
  if (next !== AIR && y > chunk.maxY) chunk.maxY = y;

  const key = chunkKey(chunk.cx, chunk.cz);
  // Border edits change the faces of the neighbouring chunk too.
  const neighbours: Array<[number, number]> = [];
  if (lx === 0) neighbours.push([chunk.cx - 1, chunk.cz]);
  if (lx === CHUNK_SIZE - 1) neighbours.push([chunk.cx + 1, chunk.cz]);
  if (lz === 0) neighbours.push([chunk.cx, chunk.cz - 1]);
  if (lz === CHUNK_SIZE - 1) neighbours.push([chunk.cx, chunk.cz + 1]);
  for (const [nx, nz] of neighbours) {
    const neighbour = world.chunks[chunkKey(nx, nz)];
    if (neighbour) neighbour.version += 1;
  }
  return {
    ...world,
    edits: {
      ...world.edits,
      [key]: { ...(world.edits[key] ?? {}), [blockKey(x, y, z)]: type },
    },
  };
}

/** Exposed cells near a point, for the 2D fallback renderer only. */
export function getVisibleBlocksNear(world: WorldData, centerX: number, centerZ: number, radius: number): BlockCell[] {
  const visible: BlockCell[] = [];
  const x0 = Math.floor(centerX - radius);
  const x1 = Math.floor(centerX + radius);
  const z0 = Math.floor(centerZ - radius);
  const z1 = Math.floor(centerZ + radius);
  for (let x = x0; x <= x1; x += 1) {
    for (let z = z0; z <= z1; z += 1) {
      const chunk = getChunk(world, x, z);
      if (!chunk) continue;
      let seenSolid = 0;
      for (let y = chunk.maxY; y >= 0 && seenSolid < 6; y -= 1) {
        const id = getBlockId(world, x, y, z);
        if (id === AIR) continue;
        seenSolid += 1;
        if (
          getBlockId(world, x + 1, y, z) === AIR || getBlockId(world, x - 1, y, z) === AIR ||
          getBlockId(world, x, y + 1, z) === AIR || getBlockId(world, x, y, z + 1) === AIR ||
          getBlockId(world, x, y, z - 1) === AIR
        ) {
          visible.push({ x, y, z, type: BLOCK_NAME_BY_ID[id] as WorldBlockType });
        }
      }
    }
  }
  return visible;
}

export function getLoadedBlockCount(world: WorldData): number {
  let total = 0;
  for (const chunk of Object.values(world.chunks)) total += chunk.solidCount;
  return total;
}

export function getLoadedChunkCount(world: WorldData): number {
  return Object.keys(world.chunks).length;
}

/** A dry, open spot near the origin; prefers grass, then sand. */
export function findSpawnPoint(world: WorldData): { x: number; y: number; z: number } {
  let best: { x: number; z: number; y: number; score: number } | null = null;
  for (let x = -96; x <= 96; x += 2) {
    for (let z = -96; z <= 96; z += 2) {
      if (!getChunk(world, x, z)) continue;
      let top = -1;
      for (let y = MAX_BUILD_HEIGHT; y >= 0; y -= 1) {
        if (getBlockId(world, x, y, z) !== AIR) { top = y; break; }
      }
      if (top < 0) continue;
      const id = getBlockId(world, x, top, z);
      const soft = id === ID.grass ? 0 : id === ID.sand || id === ID.path || id === ID.cobblestone ? 3 : id === ID.snow ? 6 : 100;
      if (soft >= 100 || IS_SOLID[id] !== 1) continue;
      let clear = true;
      for (let dy = 1; dy <= 6 && clear; dy += 1) if (getBlockId(world, x, top + dy, z) !== AIR) clear = false;
      if (!clear) continue;
      const score = Math.hypot(x, z) + soft;
      if (!best || score < best.score) best = { x, z, y: top, score };
    }
  }
  if (best) return { x: best.x + 0.5, y: best.y + 1 + PLAYER_EYE_HEIGHT, z: best.z + 0.5 };
  return { x: 0.5, y: 100, z: 0.5 };
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

export function saveWorld(world: WorldData): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ seed: world.seed, edits: world.edits }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readEdits(value: unknown): WorldData["edits"] {
  const result: WorldData["edits"] = {};
  if (!isRecord(value)) return result;
  for (const [chunk, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    const entries: Record<string, WorldBlockType | null> = {};
    for (const [key, block] of Object.entries(raw)) {
      if (!parseBlockKey(key)) continue;
      if (block === null) entries[key] = null;
      else if (isWorldBlockType(block)) entries[key] = block;
    }
    result[chunk] = entries;
  }
  return result;
}

/**
 * Worlds saved by earlier versions (keys v1 / v2) used 1 m blocks and a
 * different terrain model, so they cannot be mapped onto the new 0.5 m world;
 * they are left untouched in storage and a fresh world is started.
 */
export function loadWorld(centerX = 0, centerZ = 0, radius = 3): WorldData {
  const center = getChunkCoordinates(centerX, centerZ);
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (isRecord(parsed) && Number.isSafeInteger(parsed.seed)) {
        const world: WorldData = { seed: parsed.seed as number, chunks: {}, edits: readEdits(parsed.edits) };
        return ensureChunks(world, center.x, center.z, radius);
      }
    }
  } catch (error) {
    console.warn("Saved world could not be read; creating a new world.", error);
  }
  const world = createWorld(undefined, centerX, centerZ, radius);
  try {
    saveWorld(world);
  } catch (error) {
    console.warn("The new world could not be saved in this browser.", error);
  }
  return world;
}
