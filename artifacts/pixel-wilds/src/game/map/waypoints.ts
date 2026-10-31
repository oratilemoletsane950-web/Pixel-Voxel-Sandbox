/**
 * Named waypoints for the world map.
 *
 * Waypoints are player-authored, not generated, so they live beside the world
 * save rather than inside `WorldData`. The list is validated on read and capped
 * so a corrupt or hand-edited save cannot grow the map panel without bound.
 */
import {
  browserStorage,
  type KeyValueStorage,
} from "../storage";

export const WAYPOINT_SAVE_PREFIX = "pixel-wilds-waypoints-v1:";
export const MAX_WAYPOINTS = 24;

const COLORS = ["#e77e56", "#3d8f74", "#d8a13d", "#6d8bc4", "#a86fb0", "#c95c66"];

export interface WaypointPoint {
  x: number;
  y: number;
  z: number;
}

export interface Waypoint extends WaypointPoint {
  id: string;
  label: string;
  color: string;
  createdAt: number;
}

function cleanLabel(value: string): string {
  const label = value.replace(/\s+/g, " ").trim().slice(0, 28);
  return label || "Waypoint";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function addWaypoint(
  waypoints: readonly Waypoint[],
  point: WaypointPoint,
  label = "",
  now = Date.now(),
): Waypoint[] {
  if (waypoints.length >= MAX_WAYPOINTS) return [...waypoints];
  if (!finite(point.x) || !finite(point.y) || !finite(point.z)) return [...waypoints];
  let id = `wp-${Math.max(0, Math.floor(now))}-${waypoints.length}`;
  while (waypoints.some((waypoint) => waypoint.id === id)) id += "-x";
  const next: Waypoint = {
    id,
    label: cleanLabel(label || `Waypoint ${waypoints.length + 1}`),
    x: Math.round(point.x * 10) / 10,
    y: Math.round(point.y * 10) / 10,
    z: Math.round(point.z * 10) / 10,
    color: COLORS[waypoints.length % COLORS.length],
    createdAt: Math.max(0, Math.floor(now)),
  };
  return [...waypoints, next];
}

export function removeWaypoint(waypoints: readonly Waypoint[], id: string): Waypoint[] {
  return waypoints.filter((waypoint) => waypoint.id !== id);
}

export function renameWaypoint(
  waypoints: readonly Waypoint[],
  id: string,
  label: string,
): Waypoint[] {
  return waypoints.map((waypoint) =>
    waypoint.id === id ? { ...waypoint, label: cleanLabel(label) } : waypoint,
  );
}

export function waypointDistance(waypoint: Waypoint, point: WaypointPoint): number {
  return Math.hypot(waypoint.x - point.x, waypoint.z - point.z);
}

/** Nearest first, so the map list doubles as a compact route planner. */
export function sortWaypoints(
  waypoints: readonly Waypoint[],
  from: WaypointPoint,
): Waypoint[] {
  return [...waypoints].sort(
    (a, b) =>
      waypointDistance(a, from) - waypointDistance(b, from) ||
      a.createdAt - b.createdAt ||
      a.label.localeCompare(b.label),
  );
}

function isWaypoint(value: unknown): value is Waypoint {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Waypoint>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.label === "string" &&
    record.label.length > 0 &&
    typeof record.color === "string" &&
    finite(record.x) &&
    finite(record.y) &&
    finite(record.z) &&
    finite(record.createdAt)
  );
}

export function readWaypoints(
  worldId: string,
  storage: KeyValueStorage | null = browserStorage(),
): Waypoint[] {
  if (!storage || !worldId) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`${WAYPOINT_SAVE_PREFIX}${worldId}`) || "null");
    if (!parsed || typeof parsed !== "object") return [];
    const list = (parsed as { waypoints?: unknown }).waypoints;
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const result: Waypoint[] = [];
    for (const entry of list) {
      if (!isWaypoint(entry) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      result.push({ ...entry, label: cleanLabel(entry.label) });
      if (result.length >= MAX_WAYPOINTS) break;
    }
    return result;
  } catch {
    return [];
  }
}

export function saveWaypoints(
  worldId: string,
  waypoints: readonly Waypoint[],
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  if (!storage || !worldId) return false;
  try {
    storage.setItem(
      `${WAYPOINT_SAVE_PREFIX}${worldId}`,
      JSON.stringify({ version: 1, waypoints: waypoints.slice(0, MAX_WAYPOINTS) }),
    );
    return true;
  } catch {
    return false;
  }
}
