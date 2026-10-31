/**
 * Mining rules shared by the WebGL view and the 2D fallback.
 *
 * Hardness is authored on the block definition. A matching tool multiplies
 * speed, while tier-gated blocks (ores) are impossible to harvest with bare
 * hands or a weaker tool. Both renderers only supply elapsed time.
 */
import { BLOCK_INFO, type ToolKind, type WorldBlockType } from "../blocks";

/** Very soft blocks still take one visible tick rather than breaking on press. */
export const MIN_MINING_SECONDS = 0.12;

/** The subset of a tool the mining rules need; tool definitions satisfy it. */
export interface MiningTool {
  kind: ToolKind;
  tier: number;
  speed: number;
  /** Creative mode ignores harvest tiers without pretending to own a tool. */
  creative?: boolean;
}

/** A virtual tool used by creative worlds so every block remains editable. */
export const CREATIVE_MINING_TOOL: MiningTool = Object.freeze({
  kind: "pickaxe",
  tier: 3,
  speed: 1,
  creative: true,
});

export function requiredToolTier(type: WorldBlockType): number {
  return BLOCK_INFO[type].harvestTier;
}

/** False when the block needs a stronger or different tool than the one held. */
export function canHarvest(type: WorldBlockType, tool: MiningTool | null = null): boolean {
  const info = BLOCK_INFO[type];
  if (info.unbreakable) return false;
  if (info.harvestTier <= 0) return true;
  if (tool?.creative) return true;
  return Boolean(
    tool &&
      tool.kind === info.tool &&
      tool.tier >= info.harvestTier,
  );
}

export function miningDuration(
  type: WorldBlockType,
  tool: MiningTool | null = null,
): number {
  const info = BLOCK_INFO[type];
  if (info.unbreakable) return Infinity;
  if (!canHarvest(type, tool)) return Infinity;
  const matched = Boolean(tool && !tool.creative && info.tool === tool.kind);
  const speed = matched ? Math.max(1, tool!.speed) : 1;
  return Math.max(MIN_MINING_SECONDS, info.hardness / speed);
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
  tool: MiningTool | null = null,
): MiningStep {
  const duration = miningDuration(type, tool);
  if (!Number.isFinite(duration)) return { progress: 0, complete: false };
  const next = Math.min(1, Math.max(0, progress) + Math.max(0, deltaSeconds) / duration);
  return { progress: next, complete: next >= 1 };
}

/** Player-facing explanation for a refused block. */
export function harvestRefusal(type: WorldBlockType, tool: MiningTool | null = null): string {
  const info = BLOCK_INFO[type];
  const tier = info.harvestTier;
  if (tier <= 0 || canHarvest(type, tool)) return "";
  const toolName = info.tool ?? "tool";
  const tierName = tier >= 3 ? "iron" : tier === 2 ? "stone" : "field";
  return `${info.label} needs a ${tierName} ${toolName}`;
}
