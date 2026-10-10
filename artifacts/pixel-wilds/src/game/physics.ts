import {
  MAX_BUILD_HEIGHT,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  getBlock,
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
}

export interface MovementInput {
  forward: number;
  side: number;
  jump: boolean;
  sprint: boolean;
}

const PLAYER_RADIUS = 0.28;
const STEP_HEIGHT = 0.62;
const GRAVITY = 20;
const JUMP_SPEED = 7.2;
const WALK_SPEED = 5.2;
const SPRINT_SPEED = 7.1;

export function createPlayerMotion(world: WorldData, position: Position): PlayerMotion {
  const motion: PlayerMotion = {
    ...position,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    grounded: false,
    jumpHeld: false,
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
      if (!getBlock(world, blockX, y, blockZ)) continue;
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
      if (getBlock(world, blockX, y, blockZ)) return true;
    }
  }
  return false;
}

function approach(current: number, target: number, amount: number): number {
  if (current < target) return Math.min(target, current + amount);
  return Math.max(target, current - amount);
}

function moveAlongAxis(
  world: WorldData,
  motion: PlayerMotion,
  axis: "x" | "z",
  distance: number,
): void {
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
      return;
    }
    motion.x = nextX;
    motion.z = nextZ;
  }
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

  const inputLength = Math.hypot(input.forward, input.side);
  const divisor = inputLength > 1 ? inputLength : 1;
  const forward = input.forward / divisor;
  const side = input.side / divisor;
  const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
  const desiredX = (-Math.sin(yaw) * forward + Math.cos(yaw) * side) * speed;
  const desiredZ = (-Math.cos(yaw) * forward - Math.sin(yaw) * side) * speed;
  const hasInput = inputLength > 0.001;
  const horizontalResponse = motion.grounded
    ? hasInput ? 23 : 16
    : hasInput ? 7 : 1.5;
  motion.velocityX = approach(motion.velocityX, desiredX, horizontalResponse * dt);
  motion.velocityZ = approach(motion.velocityZ, desiredZ, horizontalResponse * dt);

  moveAlongAxis(world, motion, "x", motion.velocityX * dt);
  moveAlongAxis(world, motion, "z", motion.velocityZ * dt);

  if (input.jump && !motion.jumpHeld && motion.grounded) {
    motion.velocityY = JUMP_SPEED;
    motion.grounded = false;
  }
  motion.jumpHeld = input.jump;
  motion.velocityY -= GRAVITY * dt;

  const previousFeet = motion.y - PLAYER_EYE_HEIGHT;
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
