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
import { generateGeologicalLayers, normalizeWorldSeed } from "./worldgen";
import { Terrain, type Biome } from "./terrain";
import type { Settlement } from "./settlements";
import { groundCoverType, hasFlower, placeVegetation } from "./trees";

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
const ACTIVE_WORLD_KEY = `${STORAGE_KEY}:active`;
const worldStorageKey = (seed: number) => `${STORAGE_KEY}:seed:${seed}`;

export function listSavedWorldSeeds(): number[] {
  const seeds = new Set<number>();
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(`${STORAGE_KEY}:seed:`)) continue;
      const seed = Number(key.slice(`${STORAGE_KEY}:seed:`.length));
      if (Number.isSafeInteger(seed) && seed >= 0 && seed <= 2_147_483_647) seeds.add(seed);
    }
    const active = Number(window.localStorage.getItem(ACTIVE_WORLD_KEY));
    if (Number.isSafeInteger(active) && active >= 0 && window.localStorage.getItem(worldStorageKey(active))) seeds.add(active);
    const legacy = window.localStorage.getItem(STORAGE_KEY);
    if (legacy) {
      try {
        const parsed: unknown = JSON.parse(legacy);
        if (isRecord(parsed) && Number.isSafeInteger(parsed.seed) && (parsed.seed as number) >= 0) {
          seeds.add(parsed.seed as number);
        }
      } catch {
        // Ignore corrupt legacy metadata; individual slots remain usable.
      }
    }
  } catch {
    // Storage may be disabled; an empty list is safer than crashing the menu.
  }
  return [...seeds].sort((a, b) => a - b);
}

export function deleteSavedWorld(seed: number): void {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2_147_483_647) return;
  window.localStorage.removeItem(worldStorageKey(seed));
  if (Number(window.localStorage.getItem(ACTIVE_WORLD_KEY)) === seed) {
    window.localStorage.removeItem(ACTIVE_WORLD_KEY);
  }
  const legacy = window.localStorage.getItem(STORAGE_KEY);
  if (legacy) {
    try {
      const parsed: unknown = JSON.parse(legacy);
      if (isRecord(parsed) && parsed.seed === seed) window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }
}

export function deleteAllSavedWorlds(): void {
  for (const seed of listSavedWorldSeeds()) deleteSavedWorld(seed);
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(ACTIVE_WORLD_KEY);
  } catch {
    // The caller can report storage errors if the browser blocks writes.
  }
}

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
  normalizeWorldSeed(seed);
  let terrain = terrains.get(seed);
  if (!terrain) {
    terrain = new Terrain(seed);
    const self = terrain;
    if (terrains.size >= 2) {
      const oldest = terrains.keys().next().value;
      if (oldest !== undefined) terrains.delete(oldest);
    }
    terrains.set(seed, terrain);
  }
  return terrain;
}

/** Settlement generation is intentionally disabled while the natural-world system is rebuilt. */
export function getSettlementsNear(_seed: number, _x: number, _z: number, _radius: number): Settlement[] {
  return [];
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

  // Explicit stage order: geology/bedrock -> hydrology -> ore -> surface ecology.
  generateGeologicalLayers(writer, terrain, seed);

  // Ground-cover stage is kept separate from the geological column pass.
  for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      const x = writer.startX + lx;
      const z = writer.startZ + lz;
      const column = terrain.column(x, z);
      if (column.water <= column.ground) {
        const cover = hasFlower(column, x, z, seed) ? ID.flower : groundCoverType(column, x, z, seed);
        if (cover !== null) writer.setIfAir(x, column.ground + 1, z, cover);
      }
    }
  }

  placeOres(writer, terrain, seed);
  placeVegetation(writer, terrain, seed);

  // stampSettlements(writer, terrain, seed); // disabled per requirements

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
    if (
      !cell ||
      cell.y < 0 ||
      cell.y >= WORLD_HEIGHT ||
      cell.x < startX ||
      cell.x >= startX + CHUNK_SIZE ||
      cell.z < startZ ||
      cell.z >= startZ + CHUNK_SIZE ||
      (type !== null && !isWorldBlockType(type))
    ) continue;
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
  seed = normalizeWorldSeed(seed);
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
  if (
    ![x, y, z].every(Number.isSafeInteger) ||
    y < 0 ||
    y > MAX_BUILD_HEIGHT ||
    (type !== null && !isWorldBlockType(type))
  ) return world;
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

/**
 * A dry, open spot near (centerX, centerZ); prefers grass, then sand.
 * Used with a settlement's centre so new worlds open on a village street.
 */
export function findSpawnPoint(
  world: WorldData,
  centerX = 0,
  centerZ = 0,
): { x: number; y: number; z: number } {
  let best: { x: number; z: number; y: number; score: number } | null = null;
  for (let x = centerX - 96; x <= centerX + 96; x += 2) {
    for (let z = centerZ - 96; z <= centerZ + 96; z += 2) {
      if (!getChunk(world, x, z)) continue;
      let top = -1;
      for (let y = MAX_BUILD_HEIGHT; y >= 0; y -= 1) {
        if (getBlockId(world, x, y, z) !== AIR) { top = y; break; }
      }
      if (top < 0) continue;
      const id = getBlockId(world, x, top, z);
      // Prefer natural grass, then familiar settlement surfaces, but accept any
      // solid dry ground as a last resort. Restricting this to a short whitelist
      // could leave a perfectly usable world with no candidate and spawn the
      // player at y=100 in empty sky.
      const soft = id === ID.grass ? 0
        : id === ID.sand || id === ID.path || id === ID.cobblestone ? 3
        : id === ID.snow ? 6
        : IS_SOLID[id] === 1 ? 12 : 100;
      if (soft >= 100 || IS_SOLID[id] !== 1) continue;
      let clear = true;
      for (let dy = 1; dy <= 6 && clear; dy += 1) if (getBlockId(world, x, top + dy, z) !== AIR) clear = false;
      if (!clear) continue;
      const score = Math.hypot(x - centerX, z - centerZ) + soft;
      if (!best || score < best.score) best = { x, z, y: top, score };
    }
  }
  if (best) return { x: best.x + 0.5, y: best.y + 1 + PLAYER_EYE_HEIGHT, z: best.z + 0.5 };

  // Defensive fallback: search every loaded chunk for a column with solid
  // ground and full player clearance. Never silently place the player at a
  // fixed altitude inside terrain.
  for (const chunk of Object.values(world.chunks)) {
    const startX = chunk.cx * CHUNK_SIZE;
    const startZ = chunk.cz * CHUNK_SIZE;
    for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        const x = startX + lx;
        const z = startZ + lz;
        let top = -1;
        for (let y = MAX_BUILD_HEIGHT; y >= 0; y -= 1) {
          if (getBlockId(world, x, y, z) !== AIR) { top = y; break; }
        }
        if (top < 0 || IS_SOLID[getBlockId(world, x, top, z)] !== 1 || top + 7 >= MAX_BUILD_HEIGHT) continue;
        let clear = true;
        for (let dy = 1; dy <= 6; dy += 1) {
          if (getBlockId(world, x, top + dy, z) !== AIR) { clear = false; break; }
        }
        if (clear) return { x: x + 0.5, y: top + 1 + PLAYER_EYE_HEIGHT, z: z + 0.5 };
      }
    }
  }
  throw new Error("No safe spawn point found in generated chunks. Generate the spawn area before entering the world.");
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

export function saveWorld(world: WorldData): void {
  const serialized = JSON.stringify({ seed: world.seed, edits: world.edits });
  // Keep a separate save slot for each seed, plus a pointer to the active world.
  window.localStorage.setItem(worldStorageKey(world.seed), serialized);
  window.localStorage.setItem(ACTIVE_WORLD_KEY, String(world.seed));
  // Keep the legacy key readable for older builds.
  window.localStorage.setItem(STORAGE_KEY, serialized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readEdits(value: unknown): WorldData["edits"] {
  const result: WorldData["edits"] = {};
  if (!isRecord(value)) return result;
  for (const [chunk, raw] of Object.entries(value)) {
    const chunkParts = chunk.split(",").map(Number);
    if (
      chunkParts.length !== 2 ||
      !chunkParts.every(Number.isSafeInteger) ||
      !isRecord(raw)
    ) continue;
    const [cx, cz] = chunkParts as [number, number];
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;
    const entries: Record<string, WorldBlockType | null> = {};
    for (const [key, block] of Object.entries(raw)) {
      const cell = parseBlockKey(key);
      if (
        !cell ||
        cell.y < 0 ||
        cell.y >= WORLD_HEIGHT ||
        cell.x < startX ||
        cell.x >= startX + CHUNK_SIZE ||
        cell.z < startZ ||
        cell.z >= startZ + CHUNK_SIZE
      ) continue;
      if (block === null) entries[key] = null;
      else if (isWorldBlockType(block)) entries[key] = block;
    }
    if (Object.keys(entries).length > 0) result[chunk] = entries;
  }
  return result;
}

/**
 * Worlds saved by earlier versions (keys v1 / v2) used 1 m blocks and a
 * different terrain model, so they cannot be mapped onto the new 0.5 m world;
 * they are left untouched in storage and a fresh world is started.
 */
export function loadWorld(centerX = 0, centerZ = 0, radius = 3, requestedSeed?: number): WorldData {
  const center = getChunkCoordinates(centerX, centerZ);
  const validRequestedSeed = requestedSeed !== undefined &&
    Number.isSafeInteger(requestedSeed) && requestedSeed >= 0 && requestedSeed <= 2_147_483_647;
  try {
    const activeSeed = requestedSeed ?? Number(window.localStorage.getItem(ACTIVE_WORLD_KEY));
    const saved = Number.isSafeInteger(activeSeed) && activeSeed >= 0 && activeSeed <= 2_147_483_647
      ? window.localStorage.getItem(worldStorageKey(activeSeed)) ?? (requestedSeed === undefined ? window.localStorage.getItem(STORAGE_KEY) : null)
      : requestedSeed === undefined ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (
        isRecord(parsed) &&
        Number.isSafeInteger(parsed.seed) &&
        (parsed.seed as number) >= 0 &&
        (parsed.seed as number) <= 2_147_483_647 &&
        (!validRequestedSeed || parsed.seed === requestedSeed)
      ) {
        const world: WorldData = { seed: parsed.seed as number, chunks: {}, edits: readEdits(parsed.edits) };
        return ensureChunks(world, center.x, center.z, radius);
      }
    }
  } catch (error) {
    console.warn("Saved world could not be read; creating a new world.", error);
  }
  // If a selected slot disappeared or is corrupt while the world menu is open,
  // preserve that requested seed instead of silently entering a different world.
  const world = createWorld(validRequestedSeed ? requestedSeed : undefined, centerX, centerZ, radius);
  try {
    saveWorld(world);
  } catch (error) {
    console.warn("The new world could not be saved in this browser.", error);
  }
  return world;
}
