/**
 * Headless sanity checks for Pixel Wilds' gameplay systems: flight,
 * autojump, arrow turning (yaw), crafting, settlement placement rules,
 * furniture stamping and tree species.
 *
 * Run (no DOM needed, from artifacts/pixel-wilds):
 *   ../../node_modules/.bin/esbuild sanity.ts --bundle --platform=node \
 *     --format=esm --outfile=/tmp/pw-sanity.mjs && node /tmp/pw-sanity.mjs
 */
import { ID } from "./src/game/blocks";
import { CHUNK_SIZE, WORLD_HEIGHT, chunkIndex } from "./src/game/chunk";
import {
  MAX_BUILD_HEIGHT,
  createWorld,
  ensureChunks,
  findSpawnPoint,
  getBlockId,
  getChunk,
  getChunkCoordinates,
  getTerrain,
} from "./src/game/world";
import { PLAYER_EYE_HEIGHT } from "./src/game/world";
import { createPlayerMotion as createMotion, updatePlayerMotion as stepMotion } from "./src/game/physics";
import { CRAFTING_RECIPES, applyCraft, canCraft } from "./src/game/crafting";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ""}`);
  }
}

const seed = 20261014;

/* ---------------- crafting ---------------- */
{
  const inv: Record<string, number> = { planks: 10, wood: 2, clay: 1, coal_ore: 1 };
  const doorRecipe = CRAFTING_RECIPES.find((r) => r.id === "door")!;
  check("craft: can afford a door", canCraft(doorRecipe, inv));
  const after = applyCraft(doorRecipe, inv);
  check("craft: pays 4 planks", after.planks === 6, `planks=${after.planks}`);
  check("craft: yields 1 door", (after as Record<string, number>).door === 1);
  const poor = { ...inv, planks: 3 };
  check("craft: cannot afford with 3 planks", !canCraft(doorRecipe, poor));
  check("craft: failed craft changes nothing", applyCraft(doorRecipe, poor) === poor);
  const roofRecipe = CRAFTING_RECIPES.find((r) => r.id === "roof")!;
  check("craft: kiln recipe blocked without coal", !canCraft(roofRecipe, { ...inv, coal_ore: 0 }));
  for (const recipe of CRAFTING_RECIPES) {
    check(
      `craft: recipe '${recipe.id}' is well formed`,
      recipe.count > 0 && recipe.inputs.length > 0 && recipe.inputs.every((i) => i.count > 0),
    );
  }
}

/* ---------------- world helpers ---------------- */
let world = createWorld(seed, 0, 0, 4);
const spawn = findSpawnPoint(world);
console.log(`spawn: ${spawn.x.toFixed(1)}, ${spawn.y.toFixed(1)}, ${spawn.z.toFixed(1)}`);

function setBlockRaw(w: typeof world, x: number, y: number, z: number, type: number): void {
  const chunk = getChunk(w, x, z);
  if (!chunk) return;
  const lx = x - chunk.cx * CHUNK_SIZE;
  const lz = z - chunk.cz * CHUNK_SIZE;
  chunk.blocks[chunkIndex(lx, y, lz)] = type;
  chunk.version += 1;
  if (y > chunk.maxY) chunk.maxY = y;
}

function columnTop(x: number, z: number): number {
  for (let y = WORLD_HEIGHT - 1; y >= 0; y -= 1) {
    const id = getBlockId(world, x, y, z);
    if (id !== 0 && id !== ID.water && id !== ID.flower && id !== ID.wheat) return y;
  }
  return 0;
}

interface Input {
  forward: number;
  side: number;
  jump: boolean;
  sprint: boolean;
  descend: boolean;
}
const idle: Input = { forward: 0, side: 0, jump: false, sprint: false, descend: false };

function runIn(
  w: typeof world,
  motion: ReturnType<typeof createMotion>,
  input: Input,
  frames: number,
  yaw = 0,
): number {
  let maxY = -Infinity;
  for (let i = 0; i < frames; i += 1) {
    stepMotion(w, motion, input, yaw, 1 / 60);
    maxY = Math.max(maxY, motion.y - PLAYER_EYE_HEIGHT);
  }
  return maxY;
}

function run(motion: ReturnType<typeof createMotion>, input: Input, frames: number, yaw = 0): number {
  return runIn(world, motion, input, frames, yaw);
}

/* ---------------- autojump ---------------- */
{
  // A flat grass spot: the surface must hold for 12 columns towards -z.
  let spot: { x: number; z: number; top: number } | null = null;
  const sx = Math.floor(spawn.x);
  const sz = Math.floor(spawn.z);
  for (let x = sx - 40; x <= sx + 40 && !spot; x += 1) {
    for (let z = sz - 40; z <= sz + 40 && !spot; z += 1) {
      const top = columnTop(x, z);
      if (top < 10 || getBlockId(world, x, top, z) !== ID.grass) continue;
      let flat = true;
      for (let dz = 0; dz < 12 && flat; dz += 1) if (columnTop(x, z - dz) !== top) flat = false;
      if (flat) spot = { x, z, top };
    }
  }
  check("autojump: found a flat test spot", spot !== null);
  if (spot) {
    const { x, z, top } = spot;
    // A two-block step in front of the player.
    for (const dx of [0, 1]) {
      setBlockRaw(world, x + dx, top + 1, z - 4, ID.stone);
      setBlockRaw(world, x + dx, top + 2, z - 4, ID.stone);
    }
    const walker = createMotion(world, { x: x + 0.5, y: top + 1 + PLAYER_EYE_HEIGHT, z: z + 0.5 });
    const maxY = run(walker, { ...idle, forward: 1 }, 100, 0);
    check(
      "autojump: walks up a 2-block step without pressing space",
      maxY >= top + 1.9,
      `maxY=${maxY.toFixed(2)} expected>=${(top + 1.9).toFixed(2)}`,
    );

    // A six-block wall must NOT be climbed automatically.
    for (const dx of [0, 1]) {
      for (let h = 1; h <= 6; h += 1) setBlockRaw(world, x + dx, top + h, z - 4, ID.stone);
    }
    const walled = createMotion(world, { x: x + 0.5, y: top + 1 + PLAYER_EYE_HEIGHT, z: z + 0.5 });
    const wallMax = run(walled, { ...idle, forward: 1 }, 150, 0);
    check("autojump: leaves a 6-block wall alone", wallMax < top + 1.5, `maxY=${wallMax.toFixed(2)}`);
  }
}

/* ---------------- flight + turning ---------------- */
{
  const player = createMotion(world, spawn);
  player.flying = true;
  player.y = 150 + PLAYER_EYE_HEIGHT; // clear sky, no terrain in the way
  const before = player.y;
  run(player, { ...idle, jump: true }, 120);
  check("fly: space rises", player.y > before + 4, `rose ${(player.y - before).toFixed(2)}`);
  const high = player.y;
  run(player, { ...idle, descend: true }, 120);
  check("fly: ctrl sinks", player.y < high - 4, `sank ${(high - player.y).toFixed(2)}`);
  const still = player.y;
  run(player, idle, 240);
  check("fly: gravity is off", Math.abs(player.y - still) < 0.6, `drift ${(player.y - still).toFixed(2)}`);
  const px = player.x;
  const pz = player.z;
  run(player, { ...idle, forward: 1 }, 90);
  const moved = Math.hypot(player.x - px, player.z - pz);
  check("fly: moves horizontally", moved > 4, `moved ${moved.toFixed(2)}`);

  // yaw = pi/2 turns the walk direction by a quarter turn (what the arrow
  // keys do to yaw in the game).
  const turner = createMotion(world, spawn);
  turner.flying = true;
  turner.y = 150 + PLAYER_EYE_HEIGHT;
  const startX = turner.x;
  const startZ = turner.z;
  run(turner, { ...idle, forward: 1 }, 90, Math.PI / 2);
  check(
    "turning: yaw rotates the walk direction",
    Math.abs(turner.x - startX) > 4 && Math.abs(turner.z - startZ) < 1.5,
    `dx=${(turner.x - startX).toFixed(2)} dz=${(turner.z - startZ).toFixed(2)}`,
  );
}

/* ---------------- settlements disabled: natural spawn and no stamped furniture ---------------- */
{
  function generateAround(x: number, z: number, radiusChunks: number): typeof world {
    const center = getChunkCoordinates(x, z);
    let w = createWorld(seed, x, z, radiusChunks);
    w = ensureChunks(w, center.x, center.z, radiusChunks, radiusChunks * radiusChunks * 4 + 8);
    return w;
  }

  function countBlocks(w: typeof world, centerX: number, centerZ: number, radius: number): Record<string, number> {
    const tally: Record<string, number> = { door: 0, chair: 0, table: 0, marble: 0, stone_bricks: 0 };
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        const chunk = getChunk(w, (centerX + dx) * CHUNK_SIZE + 8, (centerZ + dz) * CHUNK_SIZE + 8);
        if (!chunk) continue;
        for (let i = 0; i < chunk.blocks.length; i += 1) {
          const id = chunk.blocks[i];
          if (id === ID.door) tally.door += 1;
          else if (id === ID.chair) tally.chair += 1;
          else if (id === ID.table) tally.table += 1;
          else if (id === ID.marble) tally.marble += 1;
          else if (id === ID.stone_bricks) tally.stone_bricks += 1;
        }
      }
    }
    return tally;
  }

  const originCenter = getChunkCoordinates(0, 0);
  const naturalWorld = generateAround(0, 0, 3);
  const naturalTally = countBlocks(naturalWorld, originCenter.x, originCenter.z, 3);
  check(
    "settlements: no settlement furniture stamps into chunks",
    naturalTally.door === 0 && naturalTally.chair === 0 && naturalTally.table === 0,
    JSON.stringify(naturalTally),
  );
  const spawnSpot = findSpawnPoint(naturalWorld, 0, 0);
  const feetY = Math.floor(spawnSpot.y - PLAYER_EYE_HEIGHT) - 1;
  const spawnBlock = getBlockId(naturalWorld, Math.floor(spawnSpot.x), feetY, Math.floor(spawnSpot.z));
  check(
    "spawn: spawn point lands on solid natural ground in loaded chunks",
    getChunk(naturalWorld, Math.floor(spawnSpot.x), Math.floor(spawnSpot.z)) !== undefined &&
      spawnBlock !== 0 &&
      spawnSpot.y < MAX_BUILD_HEIGHT,
    `y=${spawnSpot.y} ground=${spawnBlock}`,
  );

}

/* ---------------- trees: species and trunk sizes ---------------- */
{
  const terrain = getTerrain(seed);
  const found: Record<string, boolean> = { redwood: false, pineTall: false, palm: false, willow: false };
  const visited = new Set<string>();
  for (let gx = -40; gx <= 40 && !Object.values(found).every(Boolean); gx += 1) {
    for (let gz = -40; gz <= 40 && !Object.values(found).every(Boolean); gz += 1) {
      const x = gx * 37 + 11;
      const z = gz * 37 + 5;
      const column = terrain.column(x, z);
      const want =
        column.biome === "beach" ? "palm" :
        column.biome === "swamp" ? "willow" :
        column.biome === "forest" || column.biome === "taiga" ? "mixed" : null;
      if (!want) continue;
      const coords = getChunkCoordinates(x, z);
      const key = `${coords.x},${coords.z}`;
      if (visited.has(key)) continue;
      visited.add(key);
      let w = createWorld(seed, coords.x * CHUNK_SIZE + 8, coords.z * CHUNK_SIZE + 8, 1);
      w = ensureChunks(w, coords.x, coords.z, 1, 4);
      const chunk = getChunk(w, coords.x * CHUNK_SIZE + 8, coords.z * CHUNK_SIZE + 8);
      if (!chunk) continue;
      for (let lx = 0; lx < CHUNK_SIZE && !Object.values(found).every(Boolean); lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE && !Object.values(found).every(Boolean); lz += 1) {
          const base = (lx * CHUNK_SIZE + lz) * WORLD_HEIGHT;
          let ground = 0;
          for (let y = WORLD_HEIGHT - 1; y >= 1; y -= 1) {
            const id = chunk.blocks[base + y];
            if (id === 0) continue;
            if (
              id === ID.wood || id === ID.spruce_wood || id === ID.birch_wood ||
              id === ID.leaves || id === ID.birch_leaves || id === ID.spruce_leaves
            ) continue;
            ground = y;
            break;
          }
          for (const log of [ID.wood, ID.spruce_wood, ID.birch_wood]) {
            let height = 0;
            for (let y = ground + 1; y < WORLD_HEIGHT && chunk.blocks[base + y] === log; y += 1) height += 1;
            if (height === 0) continue;
            if (height >= 40) found.redwood = true;
            if (log === ID.spruce_wood && height >= 26) found.pineTall = true;
            if (want === "palm" && log === ID.wood && height >= 12) found.palm = true;
          }
          if (want === "willow") {
            // Hanging curtains: leaves close to the ground, away from any trunk.
            for (let y = ground + 2; y <= ground + 9; y += 1) {
              if (chunk.blocks[base + y] !== ID.leaves) continue;
              let nearTrunk = false;
              for (let dx = -3; dx <= 3 && !nearTrunk; dx += 1) {
                for (let dz = -3; dz <= 3 && !nearTrunk; dz += 1) {
                  const nx = lx + dx;
                  const nz = lz + dz;
                  if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) continue;
                  const nb = (nx * CHUNK_SIZE + nz) * WORLD_HEIGHT;
                  if (
                    chunk.blocks[nb + ground + 1] === ID.wood ||
                    chunk.blocks[nb + ground + 2] === ID.wood
                  ) nearTrunk = true;
                }
              }
              if (!nearTrunk) found.willow = true;
            }
          }
        }
      }
    }
  }
  console.log(`  tree species found: ${JSON.stringify(found)} (visited ${visited.size} chunks)`);
  check("trees: redwood stands have 40+ block trunks", found.redwood);
  check("trees: pine belts have 26+ block trunks", found.pineTall);
  check("trees: beaches grow palms", found.palm);
  check("trees: swamps grow willows with hanging leaves", found.willow);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
