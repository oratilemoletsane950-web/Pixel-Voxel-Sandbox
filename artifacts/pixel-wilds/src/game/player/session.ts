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
    return loadWorldData(profile.id, profile.seed, x, z, 5);
  } catch {
    return createWorld(profile.seed, x, z, 5);
  }
}

/** Spawn in wilderness rather than searching for a settlement. */
export function findSpawn(world: WorldData): Position {
  return findSpawnPoint(world, 0, 0);
}
