/**
 * Palette metadata shared by the HUD and the isometric fallback renderer.
 */
import { BLOCK_INFO, type WorldBlockType } from "../game/blocks";

export const BLOCK_META = BLOCK_INFO;

export const BLOCK_COLORS = Object.fromEntries(
  Object.values(BLOCK_INFO).map((info) => [info.name, info.colors]),
) as Record<WorldBlockType, [string, string, string]>;
