/**
 * Mining timing shared by the WebGL view and the 2D fallback.
 *
 * Hardness is authored on the block definition. Until tool tiers exist, every
 * block is mined by hand; the renderer only supplies elapsed time.
 */
import { BLOCK_INFO, type WorldBlockType } from "../blocks";

/** Very soft blocks still take one visible tick rather than breaking on press. */
export const MIN_MINING_SECONDS = 0.12;

export function miningDuration(type: WorldBlockType): number {
  const info = BLOCK_INFO[type];
  if (info.unbreakable) return Infinity;
  return Math.max(MIN_MINING_SECONDS, info.hardness);
}

export interface MiningStep {
  progress: number;
  complete: boolean;
}

/** Advances one frame of mining, clamping at completion. */
export function advanceMining(
  progress: number,
  deltaSeconds: number,
  type: WorldBlockType,
): MiningStep {
  const duration = miningDuration(type);
  if (!Number.isFinite(duration)) return { progress: 0, complete: false };
  const next = Math.min(1, Math.max(0, progress) + Math.max(0, deltaSeconds) / duration);
  return { progress: next, complete: next >= 1 };
}
