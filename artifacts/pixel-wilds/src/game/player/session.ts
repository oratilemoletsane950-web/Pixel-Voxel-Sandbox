/**
 * World session helpers shared by the app shell and both renderers.
 */
import type { Position } from "../physics";
import { createWorld, findSpawnPoint, loadWorld, type WorldData } from "../world";

/** Restores the saved world around the player, or starts a new one. */
export function initialWorld(position: Position | null = null): WorldData {
  const x = position?.x ?? 0;
  const z = position?.z ?? 0;
  try {
    return loadWorld(x, z, 5);
  } catch {
    return createWorld(undefined, x, z, 5);
  }
}

/** Spawn in wilderness rather than searching for a settlement. */
export function findSpawn(world: WorldData): Position {
  return findSpawnPoint(world, 0, 0);
}
