/**
 * Streaming policy, independent of the browser and of chunk generation.
 *
 * The planner decides *which* chunks are wanted next. It deliberately knows
 * nothing about workers, meshes or React: that keeps the look-ahead policy
 * testable and lets a renderer or a worker host reuse it.
 */
import { chunkKey } from "../chunk";
import type { WorldData } from "./types";

export interface ChunkPoint {
  x: number;
  z: number;
}

export interface PlannedChunk extends ChunkPoint {
  /** Squared distance from the player's current chunk. */
  distance: number;
  /** Positive when the chunk lies in the look direction. */
  ahead: number;
}

export interface StreamLook {
  x: number;
  z: number;
}

/**
 * A circular prefetch ring is requested around the player, with a bias toward
 * the direction the camera is facing. The render distance can stay small while
 * the next few chunks are already generated before they reach the fog line.
 */
export class ChunkStreamPlanner {
  constructor(
    readonly radius: number,
    readonly keepRadius = radius + 2,
  ) {
    if (!Number.isInteger(radius) || radius < 0) {
      throw new RangeError("Streaming radius must be a non-negative integer.");
    }
  }

  missing(
    world: WorldData,
    center: ChunkPoint,
    look: StreamLook | null = null,
    limit = Infinity,
  ): PlannedChunk[] {
    const wanted: PlannedChunk[] = [];
    const reach = this.radius + 0.5;
    for (let x = center.x - this.radius; x <= center.x + this.radius; x += 1) {
      for (let z = center.z - this.radius; z <= center.z + this.radius; z += 1) {
        const dx = x - center.x;
        const dz = z - center.z;
        const distance = dx * dx + dz * dz;
        if (distance > reach * reach) continue;
        if (world.chunks[chunkKey(x, z)]) continue;
        const length = Math.sqrt(distance) || 1;
        const ahead = look ? (dx * look.x + dz * look.z) / length : 0;
        wanted.push({ x, z, distance, ahead });
      }
    }
    wanted.sort((a, b) => {
      // Chunks in front win ties and near-ties. This is a priority hint, not a
      // visibility rule: every chunk in the ring is still generated eventually.
      const priorityA = a.distance - (a.ahead > 0.2 ? 6 : 0);
      const priorityB = b.distance - (b.ahead > 0.2 ? 6 : 0);
      return priorityA - priorityB || a.distance - b.distance || a.x - b.x || a.z - b.z;
    });
    return Number.isFinite(limit) ? wanted.slice(0, Math.max(0, Math.floor(limit))) : wanted;
  }

  /** Removes chunks that cannot be seen from the current ring. */
  prune(world: WorldData, center: ChunkPoint): WorldData | null {
    const chunks: WorldData["chunks"] = {};
    let changed = false;
    for (const [key, chunk] of Object.entries(world.chunks)) {
      if (
        Math.abs(chunk.cx - center.x) > this.keepRadius ||
        Math.abs(chunk.cz - center.z) > this.keepRadius
      ) {
        changed = true;
        continue;
      }
      chunks[key] = chunk;
    }
    return changed ? { ...world, chunks } : null;
  }
}
