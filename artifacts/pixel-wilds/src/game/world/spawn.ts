import { AIR, ID, IS_SOLID } from "../blocks";
import { CHUNK_SIZE, MAX_BUILD_HEIGHT } from "../chunk";
import { getBlockId, getChunk } from "./access";
import { PLAYER_EYE_HEIGHT, type WorldData } from "./types";

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
