/**
 * Hold-to-mine state machine shared by touch controls and tests.
 *
 * The renderer's mouse path uses its own frame loop, but the rule is the same:
 * a held target accumulates progress; changing target cancels the hold.
 */
import { blockKey, type BlockCell } from "../world";
import { advanceMining, canHarvest, miningDuration, type MiningTool } from "./mining";

export interface MiningHoldState {
  key: string;
  progress: number;
}

export function beginMiningHold(
  cell: BlockCell,
  tool: MiningTool | null,
): MiningHoldState | null {
  if (!canHarvest(cell.type, tool) || !Number.isFinite(miningDuration(cell.type, tool))) {
    return null;
  }
  return { key: blockKey(cell.x, cell.y, cell.z), progress: 0 };
}

export function advanceMiningHold(
  hold: MiningHoldState,
  cell: BlockCell,
  deltaSeconds: number,
  tool: MiningTool | null,
): { state: MiningHoldState | null; complete: boolean } {
  if (blockKey(cell.x, cell.y, cell.z) !== hold.key) {
    return { state: null, complete: false };
  }
  const step = advanceMining(hold.progress, deltaSeconds, cell.type, tool);
  if (step.complete) return { state: null, complete: true };
  return { state: { ...hold, progress: step.progress }, complete: false };
}
