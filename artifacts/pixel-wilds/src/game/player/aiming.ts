/**
 * Aiming and slot helpers.
 *
 * Voxel ray tracing is pure maths over the world, so it lives outside React and
 * is shared by the 3D renderer and the isometric fallback. Adding a new tool or
 * interaction mode only needs a different `maxDistance` or direction.
 */
import * as THREE from "three";

import { MAX_BUILD_HEIGHT } from "../chunk";
import { getBlock, type BlockCell, type WorldData } from "../world";

export type AimTarget = {
  cell: BlockCell;
  adjacent: { x: number; y: number; z: number };
};

/** Amanatides–Woo voxel traversal: the first non-water block along a ray. */
export function traceVoxelWorld(
  world: WorldData,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
): AimTarget | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);
  const stepX = Math.sign(direction.x);
  const stepY = Math.sign(direction.y);
  const stepZ = Math.sign(direction.z);
  const deltaX = stepX ? Math.abs(1 / direction.x) : Infinity;
  const deltaY = stepY ? Math.abs(1 / direction.y) : Infinity;
  const deltaZ = stepZ ? Math.abs(1 / direction.z) : Infinity;
  let nextX = stepX
    ? ((stepX > 0 ? x + 1 : x) - origin.x) / direction.x
    : Infinity;
  let nextY = stepY
    ? ((stepY > 0 ? y + 1 : y) - origin.y) / direction.y
    : Infinity;
  let nextZ = stepZ
    ? ((stepZ > 0 ? z + 1 : z) - origin.z) / direction.z
    : Infinity;
  let previous: { x: number; y: number; z: number } | null = null;

  for (let step = 0; step < 64; step += 1) {
    const type = getBlock(world, x, y, z);
    if (type && type !== "water") {
      const dominant = Math.max(
        Math.abs(direction.x),
        Math.abs(direction.y),
        Math.abs(direction.z),
      );
      return {
        cell: { x, y, z, type },
        adjacent: previous ?? {
          x: x - (Math.abs(direction.x) === dominant ? stepX : 0),
          y: y - (Math.abs(direction.y) === dominant ? stepY : 0),
          z: z - (Math.abs(direction.z) === dominant ? stepZ : 0),
        },
      };
    }

    const nextDistance = Math.min(nextX, nextY, nextZ);
    if (!Number.isFinite(nextDistance) || nextDistance > maxDistance) return null;
    previous = { x, y, z };
    if (nextX <= nextY && nextX <= nextZ) {
      x += stepX;
      nextX += deltaX;
    } else if (nextY <= nextZ) {
      y += stepY;
      nextY += deltaY;
    } else {
      z += stepZ;
      nextZ += deltaZ;
    }
  }
  return null;
}

/** The highest block in a column, for the 2D fallback's pointer picking. */
export function findColumnTop(world: WorldData, x: number, z: number) {
  for (let y = MAX_BUILD_HEIGHT; y >= 0; y -= 1) {
    const type = getBlock(world, x, y, z);
    if (type) return { y, type };
  }
  return null;
}

/** Digit keys 1-9 and 0 select hotbar slots; anything else is -1. */
export function getHotbarIndexFromCode(code: string): number {
  if (code === "Digit0") return 9;
  if (/^Digit[1-9]$/.test(code)) return Number(code.slice(-1)) - 1;
  return -1;
}
