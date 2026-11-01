/**
 * Bounded cave-light discovery.
 *
 * A point light is only useful if the surrounding rock does not hide it. This
 * module floods the connected cave volume around the camera, keeps emissive
 * blocks that the cave actually reaches, then floods each source to estimate
 * its reachable pool. The renderer uses the resulting anchors instead of
 * treating every crystal in range as equally bright.
 */
import { BLOCK_INFO, BLOCK_NAME_BY_ID } from "../blocks";
import { CHUNK_SIZE, WORLD_HEIGHT, chunkIndex } from "../chunk";
import type { WorldData } from "./types";

export interface CaveLightPoint {
  x: number;
  y: number;
  z: number;
  /** World-space light anchor. */
  position: [number, number, number];
  /** Renderer intensity derived from the source's reachable cave volume. */
  intensity: number;
  distance: number;
}

interface Cell {
  x: number;
  y: number;
  z: number;
}

const DIRECTIONS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function isOpen(world: WorldData, x: number, y: number, z: number): boolean {
  const chunk = world.chunks[`${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`];
  if (!chunk) return false;
  if (y < 0 || y >= WORLD_HEIGHT) return false;
  const lx = x - chunk.cx * CHUNK_SIZE;
  const lz = z - chunk.cz * CHUNK_SIZE;
  const id = chunk.blocks[chunkIndex(lx, y, lz)];
  const name = BLOCK_NAME_BY_ID[id];
  return id === 0 || (name ? !BLOCK_INFO[name].opaque : false);
}

/**
 * Floods from the camera through non-opaque cells. Only loaded chunks are
 * traversed, so a light never leaks in from terrain that has not streamed in.
 */
function reachableCave(
  world: WorldData,
  origin: { x: number; y: number; z: number },
  radius: number,
  limit = 14000,
): Set<string> {
  const visited = new Set<string>();
  const start: Cell = {
    x: Math.floor(origin.x),
    y: Math.floor(origin.y),
    z: Math.floor(origin.z),
  };
  if (!isOpen(world, start.x, start.y, start.z)) {
    // An eye inside a wall or at an odd camera offset still gets the closest
    // open neighbour rather than an empty light field.
    const near = DIRECTIONS.map(([dx, dy, dz]) => ({
      x: start.x + dx,
      y: start.y + dy,
      z: start.z + dz,
    })).find((cell) => isOpen(world, cell.x, cell.y, cell.z));
    if (!near) return visited;
    start.x = near.x;
    start.y = near.y;
    start.z = near.z;
  }
  const queue: Cell[] = [start];
  visited.add(cellKey(start.x, start.y, start.z));
  while (queue.length > 0 && visited.size < limit) {
    const cell = queue.shift()!;
    for (const [dx, dy, dz] of DIRECTIONS) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      const z = cell.z + dz;
      if (Math.hypot(x - origin.x, y - origin.y, z - origin.z) > radius) continue;
      const key = cellKey(x, y, z);
      if (visited.has(key) || !isOpen(world, x, y, z)) continue;
      visited.add(key);
      queue.push({ x, y, z });
    }
  }
  return visited;
}

/** Counts the open cells a source can illuminate through a short flood. */
function sourceReach(
  world: WorldData,
  source: Cell,
  radius = 10,
  limit = 900,
): number {
  const visited = new Set<string>([cellKey(source.x, source.y, source.z)]);
  const queue: Cell[] = [source];
  while (queue.length > 0 && visited.size < limit) {
    const cell = queue.shift()!;
    for (const [dx, dy, dz] of DIRECTIONS) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      const z = cell.z + dz;
      if (Math.hypot(x - source.x, y - source.y, z - source.z) > radius) continue;
      const key = cellKey(x, y, z);
      if (visited.has(key) || !isOpen(world, x, y, z)) continue;
      visited.add(key);
      queue.push({ x, y, z });
    }
  }
  return visited.size;
}

/**
 * Returns the strongest visible glow sources around `origin`, nearest first.
 * `radius` is in blocks; the camera is normally inside a cave corridor.
 */
export function caveLightsNear(
  world: WorldData,
  origin: { x: number; y: number; z: number },
  radius = 26,
  limit = 6,
): CaveLightPoint[] {
  const visible = reachableCave(world, origin, radius);
  if (visible.size === 0) return [];
  const minX = Math.floor(origin.x - radius);
  const maxX = Math.ceil(origin.x + radius);
  const minY = Math.max(0, Math.floor(origin.y - radius));
  const maxY = Math.min(WORLD_HEIGHT - 1, Math.ceil(origin.y + radius));
  const minZ = Math.floor(origin.z - radius);
  const maxZ = Math.ceil(origin.z + radius);
  const found: CaveLightPoint[] = [];

  for (let cx = Math.floor(minX / CHUNK_SIZE); cx <= Math.floor(maxX / CHUNK_SIZE); cx += 1) {
    for (let cz = Math.floor(minZ / CHUNK_SIZE); cz <= Math.floor(maxZ / CHUNK_SIZE); cz += 1) {
      const chunk = world.chunks[`${cx},${cz}`];
      if (!chunk) continue;
      const x0 = Math.max(minX, cx * CHUNK_SIZE);
      const x1 = Math.min(maxX, cx * CHUNK_SIZE + CHUNK_SIZE - 1);
      const z0 = Math.max(minZ, cz * CHUNK_SIZE);
      const z1 = Math.min(maxZ, cz * CHUNK_SIZE + CHUNK_SIZE - 1);
      for (let x = x0; x <= x1; x += 1) {
        for (let z = z0; z <= z1; z += 1) {
          const lx = x - cx * CHUNK_SIZE;
          const lz = z - cz * CHUNK_SIZE;
          const base = (lx * CHUNK_SIZE + lz) * WORLD_HEIGHT;
          for (let y = minY; y <= maxY; y += 1) {
            const id = chunk.blocks[base + y];
            if (id === 0) continue;
            const name = BLOCK_NAME_BY_ID[id];
            if (!name || !BLOCK_INFO[name]?.emissive) continue;
            if (!visible.has(cellKey(x, y, z))) continue;
            const distance = Math.hypot(x - origin.x, y - origin.y, z - origin.z);
            if (distance > radius) continue;
            const reach = sourceReach(world, { x, y, z });
            found.push({
              x,
              y,
              z,
              position: [x + 0.5, y + 0.5, z + 0.5],
              intensity: Math.min(2.1, 0.7 + reach / 260),
              distance,
            });
          }
        }
      }
    }
  }

  found.sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z || a.y - b.y);
  return found.slice(0, limit);
}
