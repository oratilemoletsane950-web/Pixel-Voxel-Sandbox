import { ID } from "./blocks";
import {
  MAX_BUILD_HEIGHT,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  getBlockId,
  isChunkLoadedAt,
  isSolidAt,
  type WorldData,
} from "./world";

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface PlayerMotion extends Position {
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  grounded: boolean;
  jumpHeld: boolean;
  /** True while flight mode is on (double-tap Space in the game view). */
  flying: boolean;
}

export interface MovementInput {
  forward: number;
  side: number;
  jump: boolean;
  sprint: boolean;
  /** Held to sink while flying (Ctrl); ignored on the ground. */
  descend: boolean;
}

/*
 * Real-world tuning at 0.5 m per block (so 1 m/s = 2 blocks/s, g = 19.6 blocks/s^2):
 *  - the 2 m player is 4 blocks tall and 0.8 blocks (0.4 m) wide;
 *  - a brisk walk of 2.3 m/s is 4.6 blocks/s, a jog of 4 m/s is 8 blocks/s;
 *  - a standing jump of about 0.6 m clears one block but not two;
 *  - the player steps up one block (0.5 m) without jumping, like a kerb or stair.
 */
export const PLAYER_RADIUS = 0.4;
const STEP_HEIGHT = 1.05;
const GRAVITY = 19.6;
const JUMP_SPEED = 6.9;
const WALK_SPEED = 4.6;
const SPRINT_SPEED = 8;
/*
 * Flight (creative-style, toggled by double-tapping Space):
 *  - cruise is faster than a sprint, Shift makes it faster still;
 *  - Space rises, Ctrl sinks, and gravity is off while it is on.
 * Autojump: a standing jump of JUMP_SPEED peaks at about 1.2 m, so any
 * obstacle between step height and ~2.3 blocks is hopped over automatically
 * while you keep walking into it - taller walls still need a manual jump.
 */
const FLY_SPEED = 10;
const FLY_SPRINT_SPEED = 17;
const FLY_RISE_SPEED = 6;
const AUTO_JUMP_MAX = 2.3;
const SWIM_SPEED = 2.8;
const SWIM_UP_SPEED = 4;
const WATER_GRAVITY = 5;
const WATER_SINK_LIMIT = 3.2;

/** True when the player's hips are below a water surface, so they swim instead of walk. */
export function isInWater(world: WorldData, motion: Position): boolean {
  const feet = motion.y - PLAYER_EYE_HEIGHT;
  return getBlockId(world, Math.floor(motion.x), Math.floor(feet + 1.2), Math.floor(motion.z)) === ID.water;
}

export function isEyeUnderwater(world: WorldData, motion: Position): boolean {
  return getBlockId(world, Math.floor(motion.x), Math.floor(motion.y), Math.floor(motion.z)) === ID.water;
}

export function createPlayerMotion(world: WorldData, position: Position): PlayerMotion {
  const motion: PlayerMotion = {
    ...position,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    grounded: false,
    jumpHeld: false,
    flying: false,
  };
  const floor = findFloor(world, motion.x, motion.z, motion.y - PLAYER_EYE_HEIGHT + 0.1);
  motion.grounded = floor !== null &&
    Math.abs(motion.y - PLAYER_EYE_HEIGHT - floor) < 0.14;
  return motion;
}

function cornerSamples(x: number, z: number): Array<[number, number]> {
  return [
    [x - PLAYER_RADIUS, z - PLAYER_RADIUS],
    [x - PLAYER_RADIUS, z + PLAYER_RADIUS],
    [x + PLAYER_RADIUS, z - PLAYER_RADIUS],
    [x + PLAYER_RADIUS, z + PLAYER_RADIUS],
  ];
}

function findFloor(
  world: WorldData,
  x: number,
  z: number,
  highestSurface: number,
): number | null {
  const firstY = Math.min(MAX_BUILD_HEIGHT, Math.floor(highestSurface));
  let highest: number | null = null;
  for (const [sampleX, sampleZ] of cornerSamples(x, z)) {
    const blockX = Math.floor(sampleX);
    const blockZ = Math.floor(sampleZ);
    for (let y = firstY; y >= 0; y -= 1) {
      if (!isSolidAt(world, blockX, y, blockZ)) continue;
      const surface = y + 1;
      if (surface > highestSurface + 0.001) continue;
      if (highest === null || surface > highest) highest = surface;
      break;
    }
  }
  return highest;
}

function hasBodyCollision(world: WorldData, x: number, eyeY: number, z: number): boolean {
  const feetY = eyeY - PLAYER_EYE_HEIGHT;
  const firstY = Math.max(0, Math.floor(feetY + 0.04));
  const lastY = Math.min(
    MAX_BUILD_HEIGHT,
    Math.floor(feetY + PLAYER_HEIGHT - 0.04),
  );
  for (const [sampleX, sampleZ] of cornerSamples(x, z)) {
    const blockX = Math.floor(sampleX);
    const blockZ = Math.floor(sampleZ);
    for (let y = firstY; y <= lastY; y += 1) {
      if (isSolidAt(world, blockX, y, blockZ)) return true;
    }
  }
  return false;
}

function approach(current: number, target: number, amount: number): number {
  if (current < target) return Math.min(target, current + amount);
  return Math.max(target, current - amount);
}

/**
 * Top surface of the obstruction that blocks horizontal motion at a target
 * position (the bottom of the blocking wall plus the height of the solid run
 * above it), or Infinity when the target position is free. This is what the
 * autojump uses: a low ledge is hopped, a castle wall is not.
 */
function obstructionTop(world: WorldData, x: number, eyeY: number, z: number): number {
  const feetY = eyeY - PLAYER_EYE_HEIGHT;
  const firstY = Math.max(0, Math.floor(feetY + 0.04));
  const lastY = Math.min(MAX_BUILD_HEIGHT, Math.floor(feetY + PLAYER_HEIGHT - 0.04));
  let lowest: number | null = null;
  for (const [sampleX, sampleZ] of cornerSamples(x, z)) {
    const blockX = Math.floor(sampleX);
    const blockZ = Math.floor(sampleZ);
    for (let y = firstY; y <= lastY; y += 1) {
      if (isSolidAt(world, blockX, y, blockZ) && (lowest === null || y < lowest)) lowest = y;
    }
  }
  if (lowest === null) return Infinity;
  // Follow the stack upwards: only its actual top decides whether a jump clears it.
  let top = lowest + 1;
  const stackLimit = Math.min(MAX_BUILD_HEIGHT, lowest + 10);
  for (let y = lowest + 1; y <= stackLimit; y += 1) {
    let solidAbove = false;
    for (const [sampleX, sampleZ] of cornerSamples(x, z)) {
      if (isSolidAt(world, Math.floor(sampleX), y, Math.floor(sampleZ))) {
        solidAbove = true;
        break;
      }
    }
    if (!solidAbove) break;
    top = y + 1;
  }
  return top;
}

/** Moves the player along one axis in small steps; returns the obstruction top when blocked. */
function moveAlongAxis(
  world: WorldData,
  motion: PlayerMotion,
  axis: "x" | "z",
  distance: number,
): number {
  const steps = Math.max(1, Math.ceil(Math.abs(distance) / 0.18));
  const step = distance / steps;
  for (let i = 0; i < steps; i += 1) {
    const nextX = motion.x + (axis === "x" ? step : 0);
    const nextZ = motion.z + (axis === "z" ? step : 0);
    const feetY = motion.y - PLAYER_EYE_HEIGHT;

    if (motion.grounded) {
      const nextFloor = findFloor(world, nextX, nextZ, feetY + STEP_HEIGHT);
      if (
        nextFloor !== null &&
        nextFloor > feetY + 0.04 &&
        nextFloor <= feetY + STEP_HEIGHT &&
        !hasBodyCollision(world, nextX, nextFloor + PLAYER_EYE_HEIGHT, nextZ)
      ) {
        motion.y = nextFloor + PLAYER_EYE_HEIGHT;
      }
    }

    if (hasBodyCollision(world, nextX, motion.y, nextZ)) {
      if (axis === "x") motion.velocityX = 0;
      else motion.velocityZ = 0;
      return obstructionTop(world, nextX, motion.y, nextZ);
    }
    motion.x = nextX;
    motion.z = nextZ;
  }
  return Infinity;
}

export function updatePlayerMotion(
  world: WorldData,
  motion: PlayerMotion,
  input: MovementInput,
  yaw: number,
  deltaSeconds: number,
): void {
  const dt = Math.max(0, Math.min(deltaSeconds, 0.05));
  if (!dt) return;
  // Hold still until the chunk underfoot has streamed in, instead of falling through the void.
  if (!isChunkLoadedAt(world, motion.x, motion.z)) return;
  const swimming = isInWater(world, motion);
  const feetY = motion.y - PLAYER_EYE_HEIGHT;

  const inputLength = Math.hypot(input.forward, input.side);
  const divisor = inputLength > 1 ? inputLength : 1;
  const forward = input.forward / divisor;
  const side = input.side / divisor;
  const speed = motion.flying
    ? input.sprint ? FLY_SPRINT_SPEED : FLY_SPEED
    : swimming ? SWIM_SPEED : input.sprint ? SPRINT_SPEED : WALK_SPEED;
  const desiredX = (-Math.sin(yaw) * forward + Math.cos(yaw) * side) * speed;
  const desiredZ = (-Math.cos(yaw) * forward - Math.sin(yaw) * side) * speed;
  const hasInput = inputLength > 0.001;
  const horizontalResponse = motion.flying
    ? 12
    : motion.grounded
      ? hasInput ? 23 : 16
      : hasInput ? 7 : 1.5;
  motion.velocityX = approach(motion.velocityX, desiredX, horizontalResponse * dt);
  motion.velocityZ = approach(motion.velocityZ, desiredZ, horizontalResponse * dt);

  // The smaller of the two axis obstructions: Infinity means that axis is free.
  const blockedTop = Math.min(
    moveAlongAxis(world, motion, "x", motion.velocityX * dt),
    moveAlongAxis(world, motion, "z", motion.velocityZ * dt),
  );

  if (motion.flying) {
    // No gravity, no ground: Space rises, Ctrl sinks, Shift is a faster cruise.
    const lift = (input.jump ? 1 : 0) - (input.descend ? 1 : 0);
    motion.velocityY = approach(motion.velocityY, lift * FLY_RISE_SPEED, 40 * dt);
    const nextY = motion.y + motion.velocityY * dt;
    if (hasBodyCollision(world, motion.x, nextY, motion.z)) motion.velocityY = 0;
    else motion.y = nextY;
    motion.grounded = false;
    motion.jumpHeld = input.jump;
    return;
  }

  if (swimming) {
    // Buoyant: Space swims up, otherwise the player drifts down slowly.
    if (input.jump) motion.velocityY = approach(motion.velocityY, SWIM_UP_SPEED, 18 * dt);
    else motion.velocityY = Math.max(-WATER_SINK_LIMIT, motion.velocityY - WATER_GRAVITY * dt);
    motion.velocityY *= 1 - Math.min(1, 1.5 * dt);
    motion.jumpHeld = input.jump;
  } else {
    if (input.jump && !motion.jumpHeld && motion.grounded) {
      motion.velocityY = JUMP_SPEED;
      motion.grounded = false;
    } else if (
      // Autojump: walking into an obstacle too tall to step over but low
      // enough to clear on a jump hops it for you, hands off the space bar.
      motion.grounded &&
      hasInput &&
      blockedTop - feetY > STEP_HEIGHT - 0.02 &&
      blockedTop - feetY <= AUTO_JUMP_MAX
    ) {
      motion.velocityY = JUMP_SPEED;
      motion.grounded = false;
      // Keep the push into the obstacle so the hop carries you up and over it.
      motion.velocityX = desiredX;
      motion.velocityZ = desiredZ;
    }
    motion.jumpHeld = input.jump;
    motion.velocityY -= GRAVITY * dt;
  }

  const previousFeet = feetY;
  let nextY = motion.y + motion.velocityY * dt;
  if (
    motion.velocityY > 0 &&
    hasBodyCollision(world, motion.x, nextY, motion.z)
  ) {
    motion.velocityY = 0;
    nextY = motion.y;
  } else if (motion.velocityY <= 0) {
    const floor = findFloor(world, motion.x, motion.z, previousFeet + 0.08);
    const nextFeet = nextY - PLAYER_EYE_HEIGHT;
    if (floor !== null && nextFeet <= floor && previousFeet >= floor - 0.04) {
      motion.y = floor + PLAYER_EYE_HEIGHT;
      motion.velocityY = 0;
      motion.grounded = true;
      return;
    }
    motion.grounded = false;
  }

  motion.y = nextY;
}
