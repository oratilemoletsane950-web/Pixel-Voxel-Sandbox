/**
 * World session helpers shared by the app shell and both renderers.
 */
import type { Position } from "../physics";
import {
  createWorld,
  findSpawnPoint,
  loadWorldData,
  type WorldData,
  type WorldProfile,
} from "../world";

/** Restores the saved snapshot for one world, or generates and saves it. */
export function initialWorld(
  profile: WorldProfile,
  position: Position | null = null,
): WorldData {
  const x = position?.x ?? 0;
  const z = position?.z ?? 0;
  try {
    // Start with only the spawn neighbourhood; the worker fills the prefetch
    // ring in the background instead of blocking the first frame.
    return loadWorldData(profile.id, profile.seed, x, z, 2);
  } catch {
    return createWorld(profile.seed, x, z, 2);
  }
}

/** Spawn in wilderness rather than searching for a settlement. */
export function findSpawn(world: WorldData): Position {
  return findSpawnPoint(world, 0, 0);
}
