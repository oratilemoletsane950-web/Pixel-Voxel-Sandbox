/**
 * Block reads and edits.
 *
 * The only module that touches a chunk's flat array directly. Everything else
 * asks these helpers, so storage layout stays an internal detail.
 */
import {
  AIR,
  BLOCK_ID,
  BLOCK_NAME_BY_ID,
  IS_SOLID,
  isWorldBlockType,
  type WorldBlockType,
} from "../blocks";
import { CHUNK_SIZE, WORLD_HEIGHT, chunkIndex, chunkKey, type Chunk } from "../chunk";
import { blockKey, type BlockCell, type WorldData } from "./types";

export function getChunk(world: WorldData, x: number, z: number): Chunk | undefined {
  return world.chunks[chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE))];
}

export function getBlockId(world: WorldData, x: number, y: number, z: number): number {
  if (y < 0 || y >= WORLD_HEIGHT) return 0;
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
    y >= WORLD_HEIGHT ||
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
