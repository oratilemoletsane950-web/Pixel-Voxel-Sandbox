/**
 * World data shapes and coordinate helpers.
 *
 * Kept dependency-light on purpose: streaming, block access, spawning and
 * persistence all share these types without importing each other.
 */
import type { WorldBlockType } from "../blocks/types";
import { CHUNK_SIZE, type Chunk } from "../chunk";

/** Scale: 1 block = 0.5 m, so the 2 m player is 4 blocks tall. */
export const PLAYER_HEIGHT = 4;
export const PLAYER_EYE_HEIGHT = 3.7;
export const DEFAULT_RENDER_RADIUS = 8;
export const MIN_RENDER_RADIUS = 4;
export const MAX_RENDER_RADIUS = 14;

export interface BlockCell {
  x: number;
  y: number;
  z: number;
  type: WorldBlockType;
}

export interface WorldData {
  seed: number;
  /** Only the currently loaded chunks live here. */
  chunks: Record<string, Chunk>;
  /** Player changes, keyed first by chunk so they re-apply when a chunk streams back in. */
  edits: Record<string, Record<string, WorldBlockType | null>>;
  /** Copied from the world profile so generation stays a pure function of its input. */
  structures?: boolean;
}

export function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function getChunkCoordinates(x: number, z: number): { x: number; z: number } {
  return { x: Math.floor(x / CHUNK_SIZE), z: Math.floor(z / CHUNK_SIZE) };
}

export function parseBlockKey(key: string): { x: number; y: number; z: number } | null {
  const parts = key.split(",");
  if (parts.length !== 3) return null;
  const [x, y, z] = parts.map(Number);
  if (![x, y, z].every(Number.isInteger)) return null;
  return { x, y, z };
}
