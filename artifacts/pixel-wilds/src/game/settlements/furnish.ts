/** Settlement interiors: stairs, furniture and forge dressing. */
import { ID } from "../blocks";
import type { ChunkWriter } from "../chunk";
import type { Building } from "./plan";

export interface StairCell {
  x: number;
  y: number;
  z: number;
}

/**
 * The walk-up staircase inside a multi-storey building: six one-block steps
 * hugging the left wall (relative to the door), climbing from the back corner
 * toward the front. Empty for one-storey buildings and for towers too small
 * to hold a flight - those are lookouts, reached by flight.
 */
export function stairCells(b: Building, ground: number): StairCell[] {
  if (b.stories < 2 || b.open) return [];
  const hx = (b.w - 1) / 2;
  const hz = (b.d - 1) / 2;
  const run = (b.facing === 0 || b.facing === 2 ? b.d : b.w) - 2;
  if (run < 6) return [];
  const cells: StairCell[] = [];
  for (let j = 0; j < 6; j += 1) {
    const y = ground + 1 + j;
    if (b.facing === 0) cells.push({ x: b.x - hx + 1, y, z: b.z - hz + 1 + j });
    else if (b.facing === 2) cells.push({ x: b.x - hx + 1, y, z: b.z + hz - 1 - j });
    else if (b.facing === 1) cells.push({ x: b.x - hx + 1 + j, y, z: b.z - hz + 1 });
    else cells.push({ x: b.x + hx - 1 - j, y, z: b.z - hz + 1 });
  }
  return cells;
}

/**
 * Places the interior furniture against the wall opposite the door, skipping
 * the stairwell. Kept separate from shell stamping so furnishing changes never
 * risk door, window or roof geometry.
 */
export function furnishInterior(
  writer: ChunkWriter,
  b: Building,
  ground: number,
  stairKeys: ReadonlySet<string>,
): void {
  const hx = (b.w - 1) / 2;
  const hz = (b.d - 1) / 2;
  const interiorLimitX = hx - 1;
  const interiorLimitZ = hz - 1;
  const occupied = new Set<string>();
  const place = (dx: number, dz: number, id: number): boolean => {
    if (Math.abs(dx) > interiorLimitX || Math.abs(dz) > interiorLimitZ) return false;
    const x = b.x + dx;
    const z = b.z + dz;
    const key = `${x},${ground + 1},${z}`;
    if (stairKeys.has(key) || occupied.has(key)) return false;
    occupied.add(key);
    writer.set(x, ground + 1, z, id);
    return true;
  };
  const alongDoor = b.facing === 0 || b.facing === 2;
  const backRow =
    b.facing === 0 ? -hz + 1 : b.facing === 2 ? hz - 1 : b.facing === 3 ? hx - 1 : -hx + 1;
  const chairRow = backRow < 0 ? backRow + 1 : backRow - 1;
  if (b.forge) {
    place(0, backRow, ID.coal_ore);
    place(-1, backRow, ID.cobblestone);
    place(1, backRow, ID.cobblestone);
  } else if (b.furniture === 2) {
    const span = Math.min(Math.floor((b.w >= b.d ? hx : hz) - 1), 7);
    for (let d = -span; d <= span; d += 1) {
      if (alongDoor) place(d, backRow, ID.table);
      else place(backRow, d, ID.table);
    }
    for (let d = -span + 1; d <= span; d += 3) {
      if (alongDoor) place(d, chairRow, ID.chair);
      else place(chairRow, d, ID.chair);
    }
  } else if (b.furniture === 1) {
    if (alongDoor) {
      place(0, backRow, ID.table);
      place(-2, backRow, ID.chair);
      place(2, backRow, ID.chair);
    } else {
      place(backRow, 0, ID.table);
      place(backRow, -2, ID.chair);
      place(backRow, 2, ID.chair);
    }
  }

  if (b.open) return;
  const name = b.blueprint.toLowerCase();
  const cornerA = alongDoor ? -interiorLimitX : -interiorLimitZ;
  const cornerB = alongDoor ? interiorLimitX : interiorLimitZ;
  const storage = /baker|forge|smith/.test(name)
    ? ID.furnace
    : /store|warehouse|granary|tavern|brewery/.test(name)
      ? ID.barrel
      : ID.chest;
  // Keep storage off the back-wall table and out of the central aisle.
  const sideZ = backRow + Math.min(2, Math.max(1, interiorLimitZ - Math.abs(backRow)));
  const sideA = alongDoor ? -interiorLimitX : -interiorLimitZ;
  const sideB = alongDoor ? interiorLimitX : interiorLimitZ;
  if (name.includes("warehouse") || name.includes("granary") || name.includes("store")) {
    if (alongDoor) {
      place(sideA, sideZ, ID.barrel);
      place(sideB, sideZ, ID.barrel);
    } else {
      place(sideZ, sideA, ID.barrel);
      place(sideZ, sideB, ID.barrel);
    }
  } else if (alongDoor) {
    place(cornerA < 0 ? sideB : sideA, sideZ, storage);
  } else {
    place(sideZ, cornerB > 0 ? sideB : sideA, storage);
  }
}
