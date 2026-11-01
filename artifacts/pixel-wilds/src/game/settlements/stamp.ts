/** Settlement stamping: writes planned buildings, walls, roads and terrain. */
import { ID } from "../blocks";
import {
  accentBlock,
  applyVictorianFacade,
  blueprintById,
  pickFrom,
  rosterPool,
  tierPalette,
  tierRoofBlock,
} from "../blueprints";
import { CHUNK_SIZE, ChunkWriter, SEA_LEVEL } from "../chunk";
import { hash2 } from "../noise";
import type { Terrain } from "../terrain";
import { leafBlob } from "../trees";
import { hierarchyNodesInBounds, hierarchyPlanFor } from "../hierarchy-streaming";
import type { HierarchyPlan, SettlementNode } from "../settlement-hierarchy";
import {
  getSettlement,
  type Building,
  type Facing,
  type Farm,
  type Garden,
  type Settlement,
  type TowerSpec,
  type WallSpec,
} from "./plan";
import { furnishInterior, stairCells } from "./furnish";

/* ------------------------------------------------------------------ */
/* Stamping                                                            */
/* ------------------------------------------------------------------ */

const DIRS: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** Residential roster shared by hierarchy stamps and placement tests. */
const HOUSE_BLUEPRINTS = [
  "simple_home",
  "farmers_cottage",
  "fishermans_hut",
  "woodcutters_cabin",
  "bakers_house",
  "carpenters_shop",
  "healers_house",
  "tavern",
  "general_store",
] as const;

/** Market stall: paved floor, corner posts, a back wall, a counter and a canopy. */
function stampStall(writer: ChunkWriter, b: Building, ground: number): void {
  const hx = (b.w - 1) / 2;
  const hz = (b.d - 1) / 2;
  const top = ground + 6;
  for (let dx = -hx; dx <= hx; dx += 1) {
    for (let dz = -hz; dz <= hz; dz += 1) {
      const x = b.x + dx;
      const z = b.z + dz;
      if (!writer.inside(x, z)) continue;
      const onX = Math.abs(dx) === hx;
      const onZ = Math.abs(dz) === hz;
      writer.set(x, ground, z, onX || onZ ? b.foundation : b.floorBlock);
      for (let y = ground + 1; y < top; y += 1) writer.set(x, y, z, 0);
      const corner = onX && onZ;
      if (corner) {
        for (let y = ground + 1; y <= top; y += 1) writer.set(x, y, z, b.frameBlock);
        continue;
      }
      const onBack =
        (b.facing === 0 && dz === -hz) || (b.facing === 2 && dz === hz) ||
        (b.facing === 1 && dx === -hx) || (b.facing === 3 && dx === hx);
      if (onBack) for (let y = ground + 1; y <= ground + 5; y += 1) writer.set(x, y, z, b.wallBlock);
    }
  }
  // Counter along the open side, with a gap to walk in.
  const counter = (dx: number, dz: number): void => {
    if (Math.abs(dx) > hx - 1 || Math.abs(dz) > hz - 1) return;
    if ((b.facing === 0 || b.facing === 2) && Math.abs(dx) < 2) return;    if ((b.facing === 1 || b.facing === 3) && Math.abs(dz) < 2) return;
    writer.set(b.x + dx, ground + 1, b.z + dz, ID.table);
  };
  if (b.facing === 0) for (let dx = -hx + 1; dx <= hx - 1; dx += 1) counter(dx, hz - 1);
  else if (b.facing === 2) for (let dx = -hx + 1; dx <= hx - 1; dx += 1) counter(dx, -hz + 1);
  else if (b.facing === 1) for (let dz = -hz + 1; dz <= hz - 1; dz += 1) counter(hx - 1, dz);  else for (let dz = -hz + 1; dz <= hz - 1; dz += 1) counter(-hx + 1, dz);

  // Canopy with a one-block overhang; the trim ring takes the tier accent.
  for (let dx = -hx - 1; dx <= hx + 1; dx += 1) {
    for (let dz = -hz - 1; dz <= hz + 1; dz += 1) {
      const x = b.x + dx;
      const z = b.z + dz;
      if (!writer.inside(x, z)) continue;
      const outer = Math.abs(dx) === hx + 1 || Math.abs(dz) === hz + 1;
      writer.set(x, top, z, outer && b.accent ? b.accent : b.roofBlock);
    }
  }
}

export function stampBuilding(writer: ChunkWriter, b: Building, ground: number): void {
  const hx = (b.w - 1) / 2;
  const hz = (b.d - 1) / 2;
  if (!writer.overlaps(b.x - hx - 3, b.z - hz - 3, b.x + hx + 3, b.z + hz + 3)) return;
  if (b.open) {
    stampStall(writer, b, ground);
    return;
  }

  const top = ground + b.wall;
  const ridgeAlongX = b.w >= b.d;
  const stairs = stairCells(b, ground);
  const stairColumns = new Set(stairs.map((cell) => `${cell.x},${cell.z}`));
  const stairKeys = new Set(stairs.map((cell) => `${cell.x},${cell.y},${cell.z}`));
  const grand = b.w >= 13 || b.d >= 13 || b.stories >= 3;
  // A portion of houses have chamfered corners, creating varied footprints.
  const chamfered = b.w >= 9 && b.d >= 9 &&
    hash2(b.x, b.z, b.blueprint.length + b.stories * 17) > 0.38;
  const clippedCorner = (dx: number, dz: number): boolean =>
    chamfered && Math.abs(dx) >= hx - 1 && Math.abs(dz) >= hz - 1 &&
    Math.abs(dx) + Math.abs(dz) > hx + hz - 1;

  for (let dx = -hx; dx <= hx; dx += 1) {
    for (let dz = -hz; dz <= hz; dz += 1) {
      if (clippedCorner(dx, dz)) continue;
      const x = b.x + dx;
      const z = b.z + dz;
      if (!writer.inside(x, z)) continue;
      writer.set(x, ground, z, b.floorBlock);
      const onX = Math.abs(dx) === hx;
      const onZ = Math.abs(dz) === hz;
      if (!onX && !onZ) {
        for (let y = ground + 1; y <= top; y += 1) writer.set(x, y, z, 0);
        continue;
      }
      const corner = onX && onZ;
      const along = onZ ? dx : dz;
      const wallLength = onZ ? hx : hz;
      const onDoorWall =
        (b.facing === 0 && dz === hz) || (b.facing === 2 && dz === -hz) ||
        (b.facing === 1 && dx === hx) || (b.facing === 3 && dx === -hx);
      const doorHalf = Math.max(1, Math.min(wallLength - 2, grand ? 2 : 1));
      const doorCell = onDoorWall && Math.abs(along) <= doorHalf && !corner;
      writer.set(x, ground, z, b.foundation);
      for (let wy = 1; wy <= b.wall; wy += 1) {
        const y = ground + wy;
        // Gatehouse archway: open through the ground floor along the passage.
        if (b.passage && wy <= 5 && (b.passage === "z" ? Math.abs(dx) <= 2 : Math.abs(dz) <= 2)) {
          writer.set(x, y, z, 0);
          continue;
        }
        if (doorCell && wy <= 5) {
          // A hung wooden door: opaque so it reads as a door, but walk-through.
          writer.set(x, y, z, ID.door);
          continue;
        }
        const local = ((wy - 1) % 6) + 1;
        let block = b.accent && local === 1 ? b.accent : corner ? b.frameBlock : b.wallBlock;
        const a = Math.abs(along);
        const windowRow = local === 3 || local === 4;
        const windowColumn = a >= 2 && a <= wallLength - 2 && (a % 4 === 2 || a % 4 === 3);
        if (b.glazed && !corner && windowRow && windowColumn && !(onDoorWall && a <= 2)) block = ID.glass;
        writer.set(x, y, z, block);
      }
    }
  }

  // Randomized entrance porches add a readable front entrance and varied massing.
  const hasPorch = b.w >= 7 && b.d >= 7 && b.stories <= 3 &&
    hash2(b.x + b.w, b.z - b.d, b.blueprint.length + 41) > 0.48;
  if (hasPorch) {
    for (let side = -1; side <= 1; side += 1) {
      let px = b.x;
      let pz = b.z;
      if (b.facing === 0) { px += side; pz += hz + 1; }
      else if (b.facing === 2) { px += side; pz -= hz + 1; }
      else if (b.facing === 1) { px += hx + 1; pz += side; }
      else { px -= hx + 1; pz += side; }
      if (!writer.inside(px, pz)) continue;
      writer.set(px, ground, pz, b.foundation);
      if (side !== 0) for (let py = ground + 1; py <= ground + 3; py += 1) writer.set(px, py, pz, b.frameBlock);
    }
    for (let side = -2; side <= 2; side += 1) {
      let px = b.x;
      let pz = b.z;
      if (b.facing === 0) { px += side; pz += hz + 2; }
      else if (b.facing === 2) { px += side; pz -= hz + 2; }
      else if (b.facing === 1) { px += hx + 2; pz += side; }
      else { px -= hx + 2; pz += side; }
      if (writer.inside(px, pz)) writer.set(px, ground + 4, pz, b.accent || b.roofBlock);
    }
  }

  // Victorian bay windows project one block from the front facade. The
  // glass is kept at eye level on each storey, with a sill and lintel.
  if (b.bayWindowWidth && b.bayWindowWidth > 0) {
    const width = Math.min(
      Math.floor((b.bayWindowWidth - 1) / 2),
      Math.max(0, Math.floor((b.facing === 0 || b.facing === 2 ? hx : hz) - 1)),
    );
    for (let offset = -width; offset <= width; offset += 1) {
      for (let storey = 0; storey < b.stories; storey += 1) {
        const y0 = ground + storey * 6 + 2;
        for (let dy = 0; dy <= 2; dy += 1) {
          let x = b.x;
          let z = b.z;
          if (b.facing === 0) { x += offset; z += hz + 1; }
          else if (b.facing === 2) { x += offset; z -= hz + 1; }
          else if (b.facing === 1) { x += hx + 1; z += offset; }
          else { x -= hx + 1; z += offset; }
          if (!writer.inside(x, z)) continue;
          const edge = Math.abs(offset) === width;
          writer.set(x, y0 + dy, z, dy === 0 || dy === 2 ? (b.accent || b.frameBlock) : edge ? b.frameBlock : ID.glass);
        }
      }
    }
  }

  // Dormer windows sit on the two roof slopes of Victorian mansard/gable roofs.
  if (b.hasDormers && (b.roof === "gable" || b.roof === "mansard" || b.roof === "hip")) {
    const positions = ridgeAlongX
      ? [-Math.floor(hx / 2), Math.floor(hx / 2)]
      : [-Math.floor(hz / 2), Math.floor(hz / 2)];
    for (const offset of positions) {
      const x = ridgeAlongX ? b.x + offset : b.x;
      const z = ridgeAlongX ? b.z : b.z + offset;
      const y = top + 2;
      if (!writer.inside(x, z)) continue;
      writer.set(x, y, z, b.frameBlock);
      writer.set(x, y + 1, z, ID.glass);
      writer.set(x, y + 2, z, b.frameBlock);
    }
  }

  // Decorative gable trim follows the ridge ends; the accent block is used
  // where available, otherwise the facade frame material keeps it coherent.
  if (b.gableTrim && b.roof === "gable") {
    const trim = b.accent || b.frameBlock;
    if (ridgeAlongX) {
      for (let dz = -hz; dz <= hz; dz += 1) {
        const y = top + (hz - Math.abs(dz)) + 1;
        for (const x of [b.x - hx, b.x + hx]) {
          if (writer.inside(x, b.z + dz)) writer.set(x, y, b.z + dz, trim);
        }
      }
    } else {
      for (let dx = -hx; dx <= hx; dx += 1) {
        const y = top + (hx - Math.abs(dx)) + 1;
        for (const z of [b.z - hz, b.z + hz]) {
          if (writer.inside(b.x + dx, z)) writer.set(b.x + dx, y, z, trim);
        }
      }
    }
  }

  // Interiors are owned by the furnish module. The shell only supplies the
  // stair columns, so furniture can never overwrite a step.
  furnishInterior(writer, b, ground, stairKeys);

  // Floor slabs for the upper storeys, with the stairwell left open.
  for (let k = 1; k < b.stories; k += 1) {
    const y = ground + 6 * k;
    if (y > top) break;
    for (let dx = -hx + 1; dx <= hx - 1; dx += 1) {
      for (let dz = -hz + 1; dz <= hz - 1; dz += 1) {        const x = b.x + dx;
        const z = b.z + dz;
        if (!writer.inside(x, z)) continue;
        if (stairColumns.has(`${x},${z}`)) continue;
        writer.set(x, y, z, b.floorBlock);
      }
    }
  }
  for (const cell of stairs) writer.set(cell.x, cell.y, cell.z, b.floorBlock);

  // Roof: gable, hip, flat with battlements, mansard skirt, or a stepped dome.
  const rx = hx + 1;
  const rz = hz + 1;
  for (let dx = -rx; dx <= rx; dx += 1) {
    for (let dz = -rz; dz <= rz; dz += 1) {
      if (clippedCorner(dx, dz)) continue;
      const x = b.x + dx;
      const z = b.z + dz;
      if (!writer.inside(x, z)) continue;
      if (b.roof === "flat") {
        if (Math.abs(dx) === rx || Math.abs(dz) === rz) continue;
        writer.set(x, top + 1, z, b.roofBlock);
        if ((Math.abs(dx) === hx || Math.abs(dz) === hz) && (dx + dz) % 2 === 0) writer.set(x, top + 2, z, b.roofBlock);
        continue;
      }
      if (b.roof === "dome" || b.roof === "mansard") {
        const inset = Math.min(rx - Math.abs(dx), rz - Math.abs(dz));
        const span = Math.max(1, Math.min(rx, rz));
        const rise = b.roof === "dome"
          ? Math.round(0.65 * span * Math.sin((Math.min(1, inset / span) * Math.PI) / 2))
          : Math.min(inset === 0 ? 1 : 2 + (inset - 1) * 2, Math.max(rx, rz));
        for (let y = top + 1; y <= top + 1 + rise; y += 1) writer.set(x, y, z, b.roofBlock);
        continue;
      }
      const rise = b.roof === "hip"
        ? Math.min(rx - Math.abs(dx), rz - Math.abs(dz))
        : ridgeAlongX ? rz - Math.abs(dz) : rx - Math.abs(dx);
      const y = top + rise;
      writer.set(x, y, z, b.roofBlock);
      if (b.roof === "gable") {
        const endWall = ridgeAlongX
          ? Math.abs(dx) === hx && Math.abs(dz) <= hz
          : Math.abs(dz) === hz && Math.abs(dx) <= hx;
        if (endWall) for (let fill = top + 1; fill < y; fill += 1) writer.set(x, fill, z, b.wallBlock);
      }
    }
  }

  // Chimney against the gable end, rising past the ridge; forges always vent.
  if (b.chimney !== 0 && (b.roof === "gable" || b.roof === "mansard" || b.forge)) {
    const px = ridgeAlongX ? b.x + hx + 1 : b.x;
    const pz = ridgeAlongX ? b.z : b.z + hz + 1;
    const ridge = b.roof === "gable" ? top + (ridgeAlongX ? rz : rx) : top + 5;
    for (let y = ground + 1; y <= ridge + 2; y += 1) writer.set(px, y, pz, b.chimney);  }

  // Roof-top turrets: the watchtower's lookout, the keep's and palace's corner
  // turrets, the mage tower's spire room. Each gets a small pyramid and finial.
  if (b.turret) {
    const spots: Array<[number, number]> = b.turret === 1
      ? [[0, 0]]
      : [[-(hx - 1), -(hz - 1)], [hx - 1, -(hz - 1)], [-(hx - 1), hz - 1], [hx - 1, hz - 1]];
    const tw = b.turret === 1 ? (Math.min(b.w, b.d) >= 11 ? 5 : 3) : 3;
    const th = (tw - 1) / 2;
    const rise = 7;
    for (const [ox, oz] of spots) {
      for (let dx = -th; dx <= th; dx += 1) {
        for (let dz = -th; dz <= th; dz += 1) {
          const x = b.x + ox + dx;
          const z = b.z + oz + dz;
          if (!writer.inside(x, z)) continue;
          const edge = Math.max(Math.abs(dx), Math.abs(dz));
          if (edge < th) {
            for (let y = top + 1; y <= top + rise; y += 1) writer.set(x, y, z, 0);
            continue;
          }
          for (let wy = 1; wy <= rise; wy += 1) {
            const corner = Math.abs(dx) === th && Math.abs(dz) === th;
            const slit = !corner && wy === 4;
            writer.set(x, top + wy, z, slit ? ID.glass : corner ? b.frameBlock : b.wallBlock);
          }
        }
      }
      for (let dx = -th - 1; dx <= th + 1; dx += 1) {
        for (let dz = -th - 1; dz <= th + 1; dz += 1) {
          const x = b.x + ox + dx;
          const z = b.z + oz + dz;
          if (!writer.inside(x, z)) continue;
          const edge = Math.max(Math.abs(dx), Math.abs(dz));
          if (edge > th + 1) continue;
          const lift = edge <= th ? Math.max(1, Math.round(((th + 1 - edge) * 5) / (th + 1))) : 0;
          for (let y = top + rise + 1; y <= top + rise + lift; y += 1) writer.set(x, y, z, b.roofBlock);
          if (edge === th + 1) writer.set(x, top + rise, z, b.roofBlock);
        }
      }
      writer.set(b.x + ox, top + rise + 6, b.z + oz, b.accent || b.roofBlock);
    }
  }

  // Chapel spire: a stepped pyramid over the crossing, with a finial.
  if (b.spire) {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const x = b.x + dx;
        const z = b.z + dz;
        if (!writer.inside(x, z)) continue;
        const rise = Math.max(Math.abs(dx), Math.abs(dz)) === 0 ? 8 : 5;
        for (let y = top + 1; y <= top + rise; y += 1) writer.set(x, y, z, b.roofBlock);
      }
    }
    writer.set(b.x, top + 9, b.z, b.accent || b.roofBlock);
  }
}

function stampWell(writer: ChunkWriter, cx: number, cz: number, ground: number): void {
  if (!writer.overlaps(cx - 3, cz - 3, cx + 3, cz + 3)) return;
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      const x = cx + dx;
      const z = cz + dz;
      if (Math.max(Math.abs(dx), Math.abs(dz)) === 2) {
        for (let y = ground - 2; y <= ground + 1; y += 1) writer.set(x, y, z, ID.cobblestone);
      } else {
        writer.set(x, ground - 3, z, ID.cobblestone);
        for (let y = ground - 2; y <= ground; y += 1) writer.set(x, y, z, ID.water);
        for (let y = ground + 1; y <= ground + 6; y += 1) writer.set(x, y, z, 0);
      }
    }
  }
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    for (let y = ground + 2; y <= ground + 6; y += 1) writer.set(cx + dx, y, cz + dz, ID.wood);
  }
  for (let dx = -3; dx <= 3; dx += 1) {
    for (let dz = -3; dz <= 3; dz += 1) {
      if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
      writer.set(cx + dx, ground + 7, cz + dz, ID.thatch);
    }
  }
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) writer.set(cx + dx, ground + 8, cz + dz, ID.thatch);
  }
}

/** Town square fountain: a stone basin you can wade in, with a pillar. */
function stampFountain(writer: ChunkWriter, cx: number, cz: number, ground: number, grand: boolean): void {
  const radius = grand ? 4 : 3;
  const rim = grand ? ID.marble : ID.cobblestone;
  if (!writer.overlaps(cx - radius, cz - radius, cx + radius, cz + radius)) return;
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      const x = cx + dx;
      const z = cz + dz;
      if (!writer.inside(x, z)) continue;
      if (Math.max(Math.abs(dx), Math.abs(dz)) === radius) {
        writer.set(x, ground, z, rim);
        writer.set(x, ground + 1, z, rim);
      } else {
        writer.set(x, ground - 1, z, rim);
        writer.set(x, ground, z, ID.water);
        writer.set(x, ground + 1, z, 0);
      }
    }
  }
  const height = grand ? 4 : 3;
  for (let y = ground + 1; y <= ground + height; y += 1) writer.set(cx, y, cz, rim);
  writer.set(cx, ground + height + 1, cz, grand ? ID.gold : ID.roof);
}

function stampFire(writer: ChunkWriter, cx: number, cz: number, ground: number): void {
  if (!writer.overlaps(cx - 3, cz - 3, cx + 3, cz + 3)) return;
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      const dist = Math.max(Math.abs(dx), Math.abs(dz));
      if (dist === 2) writer.set(cx + dx, ground + 1, cz + dz, ID.cobblestone);
      else writer.set(cx + dx, ground, cz + dz, dist === 0 ? ID.coal_ore : ID.gravel);
    }
  }
}

function stampGreatTree(writer: ChunkWriter, cx: number, cz: number, ground: number, seed: number): void {
  if (!writer.overlaps(cx - 20, cz - 20, cx + 20, cz + 20)) return;
  const height = 42;  for (let y = ground + 1; y <= ground + height; y += 1) {
    const radius = y < ground + 6 ? 3 : y < ground + 12 ? 2 : 1;
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue;
        writer.set(cx + dx, y, cz + dz, ID.birch_wood);
      }
    }
  }
  leafBlob(writer, cx, ground + height - 2, cz, 15, 9, ID.birch_leaves, seed, 0.16);
  leafBlob(writer, cx + 9, ground + height - 9, cz + 3, 8, 5, ID.leaves, seed + 1, 0.16);
  leafBlob(writer, cx - 8, ground + height - 10, cz - 4, 8, 5, ID.leaves, seed + 2, 0.16);
}

function stampFarm(writer: ChunkWriter, farm: Farm, ground: number): void {
  const hx = (farm.w - 1) / 2;
  const hz = (farm.d - 1) / 2;
  if (!writer.overlaps(farm.x - hx, farm.z - hz, farm.x + hx, farm.z + hz)) return;
  for (let dx = -hx; dx <= hx; dx += 1) {
    for (let dz = -hz; dz <= hz; dz += 1) {
      const x = farm.x + dx;
      const z = farm.z + dz;
      if (!writer.inside(x, z)) continue;
      if (dx === 0) {
        // Irrigation channel down the middle, level with the soil.
        writer.set(x, ground, z, ID.water);
        continue;
      }
      writer.set(x, ground, z, ID.farmland);
      writer.set(x, ground + 1, z, Math.abs(dz) === hz || Math.abs(dx) === hx ? 0 : ID.wheat);
    }
  }
}

/**
 * Royal gardens and parks: a clipped hedge with an opening on every side, a
 * path ring, flowers in the lawn, and a fountain in the middle.
 */
function stampGarden(writer: ChunkWriter, g: Garden, ground: number, seed: number): void {
  const hx = (g.w - 1) / 2;
  const hz = (g.d - 1) / 2;
  if (!writer.overlaps(g.x - hx - 1, g.z - hz - 1, g.x + hx + 1, g.z + hz + 1)) return;
  for (let dx = -hx; dx <= hx; dx += 1) {
    for (let dz = -hz; dz <= hz; dz += 1) {
      const x = g.x + dx;
      const z = g.z + dz;
      if (!writer.inside(x, z)) continue;
      writer.set(x, ground + 1, z, 0);
      const dist = Math.max(Math.abs(dx), Math.abs(dz));
      const doorway = Math.abs(dx) <= 1 || Math.abs(dz) <= 1;
      if (dist === hx && !doorway) {
        writer.set(x, ground + 1, z, ID.leaves);        if (Math.abs(dx) === hx && Math.abs(dz) === hz) writer.set(x, ground + 2, z, ID.leaves);
      } else if (dist === hx - 2) {
        writer.set(x, ground, z, ID.path);
      } else if (dist < hx - 2 && hash2(x, z, seed + 4441) < 0.14) {
        writer.set(x, ground + 1, z, ID.flower);
      }
    }
  }
  if (g.w >= 15) {
    stampFountain(writer, g.x, g.z, ground, g.w >= 17);
  } else {
    for (let y = ground + 1; y <= ground + 5; y += 1) writer.set(g.x, y, g.z, ID.wood);
    leafBlob(writer, g.x, ground + 8, g.z, 4, 3, ID.leaves, seed, 0.14);
  }
}

/** One square ring of wall (curtain wall or ward wall) with gates and merlons. */
function stampRing(
  writer: ChunkWriter,
  centerX: number,
  centerZ: number,
  half: number,
  wall: WallSpec,
  salt: number,
  ground: number,
): void {
  const inner = half - 2;
  const minX = Math.max(centerX - half, writer.startX);
  const maxX = Math.min(centerX + half, writer.startX + CHUNK_SIZE - 1);
  const minZ = Math.max(centerZ - half, writer.startZ);
  const maxZ = Math.min(centerZ + half, writer.startZ + CHUNK_SIZE - 1);
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const dx = x - centerX;
      const dz = z - centerZ;
      if (Math.max(Math.abs(dx), Math.abs(dz)) < inner) continue;
      let gate = false;
      for (const facing of wall.gates) {
        const [gx, gz] = DIRS[facing];
        if (gx !== 0 && Math.sign(dx) === gx && Math.abs(dz) <= wall.gateHalfWidth) gate = true;
        if (gz !== 0 && Math.sign(dz) === gz && Math.abs(dx) <= wall.gateHalfWidth) gate = true;
      }
      const jitter = wall.palisade ? Math.floor(hash2(x, z, salt + 7) * 3) : 0;
      const height = wall.palisade ? wall.height - 1 + jitter : wall.height;
      for (let y = ground + 1; y <= ground + height; y += 1) {
        if (gate && y <= ground + (wall.palisade ? 6 : 9)) continue;
        // Crenellations: stone walls alternate raised and lowered blocks along the top.
        if (!wall.palisade && y === ground + height && (x + z) % 2 === 0) continue;
        writer.set(x, y, z, wall.block);
      }
    }
  }
}

function stampWall(writer: ChunkWriter, s: Settlement, ground: number): void {
  if (s.wall) stampRing(writer, s.centerX, s.centerZ, s.radius, s.wall, s.baseY, ground);
}

function stampTower(writer: ChunkWriter, t: TowerSpec, ground: number): void {
  const h = (t.w - 1) / 2;
  if (!writer.overlaps(t.x - h - 1, t.z - h - 1, t.x + h + 1, t.z + h + 1)) return;
  for (let dx = -h - 1; dx <= h + 1; dx += 1) {
    for (let dz = -h - 1; dz <= h + 1; dz += 1) {
      const x = t.x + dx;
      const z = t.z + dz;
      if (!writer.inside(x, z)) continue;
      const edge = Math.max(Math.abs(dx), Math.abs(dz));
      if (edge <= h) {
        writer.set(x, ground, z, ID.planks);
        if (edge < h) for (let y = ground + 1; y <= ground + t.height; y += 1) writer.set(x, y, z, 0);
      }
      if (edge === h) {
        const corner = Math.abs(dx) === h && Math.abs(dz) === h;
        const doorCell = Math.abs(dx) <= 1 || Math.abs(dz) <= 1;
        const open = t.doors ? doorCell : dz === h && Math.abs(dx) <= 1;
        for (let wy = 1; wy <= t.height; wy += 1) {
          if (open && wy <= 5) {
            writer.set(x, ground + wy, z, ID.door);
            continue;
          }
          const band = wy % 9 === 0;
          const slit = !corner && wy > 8 && (wy % 9 === 4 || wy % 9 === 5) && Math.abs(dx % 4) !== 0 && Math.abs(dz % 4) !== 0;
          writer.set(x, ground + wy, z, slit ? ID.glass : band || corner ? t.bandBlock : t.wallBlock);
        }
      }
      // Solid pyramid roof with a small overhang.
      const lift = Math.round(((h + 1 - edge) * t.roofRise) / (h + 1));
      const roofTop = ground + t.height + (edge <= h ? Math.max(1, lift) : 0);
      for (let y = ground + t.height + 1; y <= roofTop; y += 1) writer.set(x, y, z, t.roofBlock);
      if (edge === h + 1) writer.set(x, ground + t.height, z, t.roofBlock);
    }
  }
  writer.set(t.x, ground + t.height + t.roofRise + 1, t.z, ID.glass);
}

/**
 * The moat around a castle or kingdom: a four-block channel two blocks below
 * the street, crossed by a paved bridge with low rails at each of the four
 * gates. Carved before walls and towers so they can stand on its bank.
 */
function stampMoat(writer: ChunkWriter, s: Settlement, ground: number): void {
  if (!s.wall) return;
  const cx = s.centerX;
  const cz = s.centerZ;
  const half = s.radius;
  const walkHalf = 3;
  for (let dx = -(half + 4); dx <= half + 4; dx += 1) {
    for (let dz = -(half + 4); dz <= half + 4; dz += 1) {
      const cheb = Math.max(Math.abs(dx), Math.abs(dz));
      if (cheb < half + 1 || cheb > half + 4) continue;
      const x = cx + dx;
      const z = cz + dz;
      if (!writer.inside(x, z)) continue;
      const bridge =
        (Math.abs(dx) <= walkHalf && Math.abs(dz) >= half - 2) ||
        (Math.abs(dz) <= walkHalf && Math.abs(dx) >= half - 2);
      if (bridge) continue;
      for (let y = ground - 1; y <= ground + 2; y += 1) writer.set(x, y, z, 0);
      writer.set(x, ground - 2, z, ID.water);
      writer.set(x, ground - 3, z, ID.water);
      writer.set(x, ground - 4, z, ID.gravel);
    }
  }
  // Bridges: deck from just inside the wall to past the channel, with rails.
  for (const [ox, oz] of DIRS) {
    for (let cross = -walkHalf; cross <= walkHalf; cross += 1) {
      for (let along = half - 2; along <= half + 4; along += 1) {
        const x = cx + (ox !== 0 ? ox * along : cross);
        const z = cz + (oz !== 0 ? oz * along : cross);        if (!writer.inside(x, z)) continue;
        writer.set(x, ground, z, ID.stone_bricks);
        writer.set(x, ground + 1, z, Math.abs(cross) === walkHalf ? s.wall!.block : 0);
      }
    }
  }
}

function groundCover(s: Settlement, dx: number, dz: number): number {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  const limit = s.radius - 3;
  if (ax > limit || az > limit) return 0;
  if (ax <= 5 && az <= 5) return s.plazaBlock;
  if (ax <= 2 || az <= 2) return s.streetBlock;
  return 0;
}

export function stampSettlements(writer: ChunkWriter, terrain: Terrain, seed: number): void {
  const { startX, startZ } = writer;
  const endX = startX + CHUNK_SIZE - 1;
  const endZ = startZ + CHUNK_SIZE - 1;
  const originSettlement = getSettlement(terrain, 0, 0);
  const hierarchyOriginX = originSettlement?.kind === "kingdom" ? originSettlement.centerX : 0;
  const hierarchyOriginZ = originSettlement?.kind === "kingdom" ? originSettlement.centerZ : 0;
  const hierarchyPlan = hierarchyPlanFor(seed, { originX: hierarchyOriginX, originZ: hierarchyOriginZ });
  // Legacy settlement geometry has been retired. The old generator remains
  // available only for deterministic starting-kingdom/spawn metadata; no legacy
  // village, town, castle or kingdom blocks are stamped into streamed chunks.

  // Hierarchy house nodes are the source of these residential buildings. Keep
  // this after legacy settlement stamping so the hierarchy owns its own homes
  // without changing the existing settlement landmarks in this increment.
  stampHierarchyHouseNodes(writer, terrain, seed);
}

type CastleLayout = {
  outerRadius: number; outerHeight: number; innerRadius: number; innerHeight: number;
  innerRise: number; keepRadius: number; keepHeight: number; keepRise: number;
  gateHalfWidth: number; towerHalf: number; towerExtra: number; gateTowers: boolean;
  keepSize: number; keepWall: number; moat: boolean;
};

function castleLayout(archetype: string): CastleLayout {
  switch (archetype) {
    case "hilltop":
      return { outerRadius: 43, outerHeight: 12, innerRadius: 27, innerHeight: 10, innerRise: 3,
        keepRadius: 0, keepHeight: 0, keepRise: 0, gateHalfWidth: 2, towerHalf: 4,
        towerExtra: 10, gateTowers: false, keepSize: 15, keepWall: 36, moat: false };
    case "riverside":
      return { outerRadius: 50, outerHeight: 9, innerRadius: 32, innerHeight: 9, innerRise: 2,
        keepRadius: 0, keepHeight: 0, keepRise: 0, gateHalfWidth: 3, towerHalf: 4,
        towerExtra: 6, gateTowers: true, keepSize: 19, keepWall: 24, moat: true };
    case "palace-fortress":
      return { outerRadius: 44, outerHeight: 8, innerRadius: 0, innerHeight: 0, innerRise: 0,
        keepRadius: 0, keepHeight: 0, keepRise: 0, gateHalfWidth: 3, towerHalf: 3,
        towerExtra: 5, gateTowers: true, keepSize: 23, keepWall: 30, moat: true };
    case "concentric":
    default:
      return { outerRadius: 56, outerHeight: 10, innerRadius: 38, innerHeight: 9, innerRise: 2,
        keepRadius: 20, keepHeight: 8, keepRise: 4, gateHalfWidth: 3, towerHalf: 4,
        towerExtra: 7, gateTowers: false, keepSize: 17, keepWall: 24, moat: false };
  }
}

function stampCastleTower(
  writer: ChunkWriter, cx: number, cz: number, ground: number, half: number, height: number,
): void {
  if (!writer.overlaps(cx - half - 1, cz - half - 1, cx + half + 1, cz + half + 1)) return;
  for (let dx = -half; dx <= half; dx += 1) for (let dz = -half; dz <= half; dz += 1) {
    const x = cx + dx; const z = cz + dz;
    if (!writer.inside(x, z) || Math.max(Math.abs(dx), Math.abs(dz)) !== half) continue;
    const corner = Math.abs(dx) === half && Math.abs(dz) === half;
    for (let y = ground; y < ground + height; y += 1) {
      const slit = !corner && y === ground + 4 && (dx === 0 || dz === 0);
      if (!slit) writer.set(x, y, z, corner || y % 8 === 0 ? ID.cobblestone : ID.stone_bricks);
    }
    for (let offset = -half; offset <= half; offset += 2) {
      if (Math.abs(dx) === half && dz === offset) writer.set(x, ground + height, z, ID.stone_bricks);
      if (Math.abs(dz) === half && dx === offset) writer.set(x, ground + height, z, ID.stone_bricks);
    }
  }
}

/**
 * Turn nearby hierarchy house records into real block-stamped buildings.
 * Terrain is sampled at the centre and corners; wet or excessively uneven
 * sites are skipped rather than placing houses through rivers or cliffs.
 */

type ResolvedFootprint = { x: number; z: number; halfW: number; halfD: number; ownerId: string; level: string };
const resolvedPlansByTerrain = new WeakMap<Terrain, Map<string, HierarchyPlan>>();

/** World-space box used to avoid resolving the entire global house roster. */
export interface HierarchyResolveBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function resolveHierarchyPlan(
  source: HierarchyPlan,
  terrain: Terrain,
  bounds?: HierarchyResolveBounds,
  previous?: HierarchyPlan,
): HierarchyPlan {
  const nodes: SettlementNode[] = (previous ?? source).nodes.map((node) => ({
    ...node,
    children: [...node.children],
    metadata: { ...node.metadata },
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const originalById = new Map(source.nodes.map((node) => [node.id, node]));
  const major: ResolvedFootprint[] = [];
  const buckets = new Map<string, ResolvedFootprint[]>();
  const bucketSize = 64;
  const bucketKey = (x: number, z: number) => Math.floor(x / bucketSize) + ":" + Math.floor(z / bucketSize);
  const addHouseSite = (site: ResolvedFootprint) => {
    const key = bucketKey(site.x, site.z);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(site);
    else buckets.set(key, [site]);
  };
  const overlaps = (
    x: number,
    z: number,
    halfW: number,
    halfD: number,
    parentId: string | null,
  ) => {
    for (let bx = Math.floor((x - halfW - 20) / bucketSize); bx <= Math.floor((x + halfW + 20) / bucketSize); bx += 1) {
      for (let bz = Math.floor((z - halfD - 20) / bucketSize); bz <= Math.floor((z + halfD + 20) / bucketSize); bz += 1) {
        for (const other of buckets.get(bx + ":" + bz) ?? []) {
          if (other.ownerId === parentId) continue;
          if (Math.abs(x - other.x) < halfW + other.halfW + 3 && Math.abs(z - other.z) < halfD + other.halfD + 3) return true;
        }
      }
    }
    return major.some((other) => other.ownerId !== parentId &&
      Math.abs(x - other.x) < halfW + other.halfW + 4 && Math.abs(z - other.z) < halfD + other.halfD + 4);
  };
  const offsetCache = new Map<number, Array<[number, number]>>();
  const offsets = (radiusMax: number): Array<[number, number]> => {
    const cached = offsetCache.get(radiusMax);
    if (cached) return cached;
    const result: Array<[number, number]> = [[0, 0]];
    for (let radius = 16; radius <= radiusMax; radius += 16) {
      const steps = Math.max(8, Math.round((Math.PI * 2 * radius) / 32));
      for (let step = 0; step < steps; step += 1) {
        const angle = Math.PI * 2 * step / steps;
        result.push([Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)]);
      }
    }
    offsetCache.set(radiusMax, result);
    return result;
  };
  const assess = (x: number, z: number, halfW: number, halfD: number, maxSpread: number, maxHeight: number) => {
    const samples = [
      terrain.natural(x, z),
      terrain.natural(x - halfW, z - halfD), terrain.natural(x + halfW, z - halfD),
      terrain.natural(x - halfW, z + halfD), terrain.natural(x + halfW, z + halfD),
      terrain.natural(x - halfW, z), terrain.natural(x + halfW, z),
      terrain.natural(x, z - halfD), terrain.natural(x, z + halfD),
    ];
    if (samples.some((sample) => sample.water > 0 || sample.riverDist < sample.riverHalfWidth + 3)) return null;
    const heights = samples.map((sample) => sample.ground);
    const spread = Math.max(...heights) - Math.min(...heights);
    const ground = [...heights].sort((a, b) => a - b)[Math.floor(heights.length / 2)];
    if (spread > maxSpread || ground <= SEA_LEVEL + 2 || ground + maxHeight >= 192) return null;
    return { ground, spread };
  };

  // Reuse previously resolved positions. This keeps a node's world position
  // stable as the streamer asks for neighbouring chunks, and lets the same
  // world plan accumulate local house resolutions instead of redoing them.
  if (previous) {
    for (const node of nodes) {
      if (node.metadata.placementValid !== true) continue;
      if (["city", "town", "village", "castle"].includes(node.level)) {
        const size = node.level === "city" ? 20 : node.level === "town" ? 55 : node.level === "village" ? 10 : 66;
        const footprint = { x: node.x, z: node.z, halfW: size, halfD: size, ownerId: node.id, level: node.level };
        major.push(footprint);
        if (node.level === "village") addHouseSite(footprint);
      } else if (node.level === "house") {
        const archetype = Math.max(0, Math.min(HOUSE_BLUEPRINTS.length - 1, Math.floor(Number(node.metadata.archetypeIndex) || 0)));
        const bp = blueprintById("village", HOUSE_BLUEPRINTS[archetype]);
        addHouseSite({
          x: node.x,
          z: node.z,
          halfW: Math.ceil(bp.w / 2),
          halfD: Math.ceil(bp.d / 2),
          ownerId: node.id,
          level: "house",
        });
      }
    }
  }

  // Resolve major sites once per world. Children follow their resolved parent's displacement.
  const majorNodes = nodes.filter((node) => ["city", "town", "village", "castle"].includes(node.level));
  const rank = { city: 0, town: 1, village: 2, castle: 3 } as const;
  majorNodes.sort((a, b) => rank[a.level as keyof typeof rank] - rank[b.level as keyof typeof rank] || a.id.localeCompare(b.id));
  for (const node of majorNodes) {
    if (node.metadata.placementValid === true) continue;
    if (node.metadata.placementFailed === true) continue;
    const original = originalById.get(node.id)!;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const originalParent = node.parentId ? originalById.get(node.parentId) : undefined;
    const size = node.level === "city" ? 20 : node.level === "town" ? 55 : node.level === "village" ? 10 : 66;
    const radiusMax = node.level === "city" ? 384 : node.level === "town" ? 256 : node.level === "village" ? 128 : 320;
    if (bounds) {
      // Include enough reach for parents and roads connecting nearby nodes.
      const reach = radiusMax + 900;
      if (
        original.x < bounds.minX - reach || original.x > bounds.maxX + reach ||
        original.z < bounds.minZ - reach || original.z > bounds.maxZ + reach
      ) {
        node.metadata.placementDeferred = true;
        node.metadata.placementValid = false;
        continue;
      }
    }
    const anchorX = Math.round(original.x + (parent && originalParent ? parent.x - originalParent.x : 0));
    const anchorZ = Math.round(original.z + (parent && originalParent ? parent.z - originalParent.z : 0));
    const maxSpread = node.level === "city" ? 10 : node.level === "town" ? 8 : node.level === "village" ? 7 : 36;
    const maxHeight = node.level === "city" ? 32 : node.level === "town" ? 30 : node.level === "village" ? 12 : 52;
    let best: { x: number; z: number; ground: number; score: number } | null = null;
    for (const [dx, dz] of offsets(radiusMax)) {
      const x = anchorX + dx;
      const z = anchorZ + dz;
      if (major.some((other) => Math.abs(x - other.x) < size + other.halfW + 8 && Math.abs(z - other.z) < size + other.halfD + 8)) continue;
      const site = assess(x, z, size, size, maxSpread, maxHeight);
      if (!site) continue;
      let score = site.spread * 12 + Math.hypot(dx, dz) * 0.08;
      if (node.level === "castle") {
        const elevation = site.ground - SEA_LEVEL;
        const archetype = String(node.metadata.archetype ?? "concentric");
        if (archetype === "hilltop") score -= Math.min(elevation, 60) * 0.35;
        else if (archetype === "palace-fortress") score += Math.abs(elevation - 18) * 0.12;
        else score -= Math.min(elevation, 36) * 0.08;
      }
      if (!best || score < best.score) best = { x, z, ground: site.ground, score };
      const preferredSpread = node.level === "city" ? 4 : node.level === "town" ? 3
        : node.level === "village" ? 3 : 12;
      const nearEnough = Math.hypot(dx, dz) <= (node.level === "castle" ? 160 : 96);
      if (site.spread <= preferredSpread && nearEnough) break;
    }
    if (!best) {
      node.metadata.placementFailed = true;
      node.metadata.placementValid = false;
      continue;
    }
    node.x = best.x; node.z = best.z;
    node.metadata.resolvedGround = best.ground;
    node.metadata.placementValid = true;
    delete node.metadata.placementDeferred;
    delete node.metadata.placementFailed;
    const footprint: ResolvedFootprint = { x: node.x, z: node.z, halfW: size, halfD: size, ownerId: node.id, level: node.level };
    major.push(footprint);
    if (node.level === "village") addHouseSite(footprint);
  }

  // Resolve residential footprints only where chunks can actually request
  // them. The global plan contains thousands of houses, most thousands of
  // blocks from the player; resolving those on the first chunk blocked the
  // worker for ~19 seconds. A 240-block apron covers the largest house shift.
  const blueprintIds = HOUSE_BLUEPRINTS;
  for (const node of nodes) {
    if (node.level !== "house") continue;
    if (node.metadata.placementValid === true) continue;
    if (node.metadata.placementFailed === true) continue;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const original = originalById.get(node.id)!;
    const originalParent = node.parentId ? originalById.get(node.parentId) : undefined;
    if (bounds && (
      original.x < bounds.minX - 240 || original.x > bounds.maxX + 240 ||
      original.z < bounds.minZ - 240 || original.z > bounds.maxZ + 240
    )) {
      node.metadata.placementDeferred = true;
      node.metadata.placementValid = false;
      continue;
    }
    if (!parent || parent.metadata.placementValid !== true) {
      node.metadata.placementFailed = true;
      node.metadata.placementValid = false;
      continue;
    }
    const anchorX = Math.round(original.x + parent.x - (originalParent?.x ?? parent.x));
    const anchorZ = Math.round(original.z + parent.z - (originalParent?.z ?? parent.z));
    const archetype = Math.max(0, Math.min(HOUSE_BLUEPRINTS.length - 1, Math.floor(Number(node.metadata.archetypeIndex) || 0)));
    const bp = blueprintById("village", blueprintIds[archetype]);
    const halfW = Math.ceil(bp.w / 2);
    const halfD = Math.ceil(bp.d / 2);
    let chosen: { x: number; z: number; ground: number; score: number } | null = null;
    const candidates: Array<[number, number]> = [[0, 0]];
    for (let radius = 4; radius <= 192; radius += 4) {
      for (let step = 0; step < 16; step += 1) {
        const angle = Math.PI * 2 * step / 16;
        candidates.push([Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)]);
      }
    }
    for (const [dx, dz] of candidates) {
      const x = anchorX + dx;
      const z = anchorZ + dz;
      if (overlaps(x, z, halfW, halfD, node.parentId)) continue;
      const site = assess(x, z, halfW, halfD, 5, bp.stories * 6 + 8);
      if (!site) continue;
      // The first usable site is enough. Searching every candidate for a
      // slightly flatter one made the initial chunk spend ~19 seconds resolving
      // thousands of distant houses before any terrain could stream.
      const score = site.spread * 10 + Math.hypot(dx, dz);
      chosen = { x, z, ground: site.ground, score };
      break;
    }
    if (!chosen) {
      node.metadata.placementFailed = true;
      node.metadata.placementValid = false;
      continue;
    }
    node.x = chosen.x; node.z = chosen.z;
    node.metadata.resolvedGround = chosen.ground;
    node.metadata.placementValid = true;
    delete node.metadata.placementDeferred;
    delete node.metadata.placementFailed;
    addHouseSite({ x: node.x, z: node.z, halfW, halfD, ownerId: node.id, level: "house" });
  }
  return { ...source, nodes };
}

function resolvedHierarchyPlanFor(
  terrain: Terrain,
  seed: number,
  originX: number,
  originZ: number,
  bounds: HierarchyResolveBounds,
): HierarchyPlan {
  const key = [seed >>> 0, Math.round(originX), Math.round(originZ)].join(":");
  let cache = resolvedPlansByTerrain.get(terrain);
  if (!cache) { cache = new Map<string, HierarchyPlan>(); resolvedPlansByTerrain.set(terrain, cache); }
  const previous = cache.get(key);
  // One persistent plan per world keeps house positions stable across chunk
  // boundaries. New chunks add only their local unresolved homes.
  const resolved = resolveHierarchyPlan(
    hierarchyPlanFor(seed, { originX, originZ }),
    terrain,
    bounds,
    previous,
  );
  if (cache.size >= 6) cache.delete(cache.keys().next().value!);
  cache.set(key, resolved);
  return resolved;
}

function stampHierarchyHouseNodes(writer: ChunkWriter, terrain: Terrain, seed: number): void {
  const start = getSettlement(terrain, 0, 0);
  const originX = start?.kind === "kingdom" ? start.centerX : 0;
  const originZ = start?.kind === "kingdom" ? start.centerZ : 0;
  const chunkMinX = writer.startX;
  const chunkMinZ = writer.startZ;
  const chunkMaxX = chunkMinX + CHUNK_SIZE - 1;
  const chunkMaxZ = chunkMinZ + CHUNK_SIZE - 1;
  const plan = resolvedHierarchyPlanFor(terrain, seed, originX, originZ, {
    minX: chunkMinX,
    minZ: chunkMinZ,
    maxX: chunkMaxX,
    maxZ: chunkMaxZ,
  });
  // Pull endpoints far enough away to draw the roads crossing this chunk.
  const nodes = hierarchyNodesInBounds(plan, chunkMinX, chunkMinZ, chunkMaxX, chunkMaxZ, 520);
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  // All positions and footprints are resolved once for the full world before chunk stamping.

  const stampRoad = (fromX: number, fromZ: number, toX: number, toZ: number, width: number): void => {
    const minX = Math.max(Math.min(fromX, toX) - width, chunkMinX);
    const maxX = Math.min(Math.max(fromX, toX) + width, chunkMaxX);
    const minZ = Math.max(Math.min(fromZ, toZ) - width, chunkMinZ);
    const maxZ = Math.min(Math.max(fromZ, toZ) + width, chunkMaxZ);
    if (minX > maxX || minZ > maxZ) return;
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const lengthSq = dx * dx + dz * dz || 1;
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const t = Math.max(0, Math.min(1, ((x - fromX) * dx + (z - fromZ) * dz) / lengthSq));
        const nearestX = fromX + t * dx;
        const nearestZ = fromZ + t * dz;
        if (Math.hypot(x - nearestX, z - nearestZ) > width / 2) continue;
        const sample = terrain.natural(x, z);
        const riverCrossing = Number.isFinite(sample.riverDist) &&
          sample.riverDist < sample.riverHalfWidth + 7;
        if (sample.water > 0) {
          // Only bridge mapped river channels, never sea or lake water.
          if (!riverCrossing) continue;
          const bridgeY = sample.water;
          if (bridgeY < SEA_LEVEL || bridgeY + 3 >= 192) continue;
          writer.set(x, bridgeY, z, ID.dark_planks);
          writer.set(x, bridgeY + 1, z, 0);
          writer.set(x, bridgeY + 2, z, 0);
          continue;
        }
        if (sample.ground <= SEA_LEVEL + 1 || sample.ground + 2 >= 192) continue;
        if (riverCrossing) {
          writer.set(x, sample.ground, z, ID.dark_planks);
        } else {
          writer.set(x, sample.ground, z, ID.gravel);
        }
        writer.set(x, sample.ground + 1, z, 0);
        writer.set(x, sample.ground + 2, z, 0);
      }
    }
  };

  const stampRingWithGates = (
    x: number, z: number, radius: number, ground: number, height: number,
    block: number, gateHalfWidth: number,
  ): void => {
    const minX = Math.max(x - radius, chunkMinX);
    const maxX = Math.min(x + radius, chunkMaxX);
    const minZ = Math.max(z - radius, chunkMinZ);
    const maxZ = Math.min(z + radius, chunkMaxZ);
    if (minX > maxX || minZ > maxZ) return;
    for (let px = minX; px <= maxX; px += 1) {
      for (let pz = minZ; pz <= maxZ; pz += 1) {
        const edge = Math.max(Math.abs(px - x), Math.abs(pz - z));
        if (Math.abs(edge - radius) > 0) continue;
        const dx = px - x;
        const dz = pz - z;
        const cardinalGate = (Math.abs(dx) <= gateHalfWidth && Math.abs(dz) === radius) ||
          (Math.abs(dz) <= gateHalfWidth && Math.abs(dx) === radius);
        if (cardinalGate) continue;
        for (let y = ground; y < ground + height; y += 1) {
          const crenel = height >= 7 && y === ground + height - 1 && ((px + pz) & 1) === 0;
          writer.set(px, y, pz, crenel ? ID.stone_bricks : block);
        }
      }
    }
    // Gate piers make each opening legible without closing the passage.
    for (const [gx, gz] of [[x, z - radius], [x, z + radius], [x - radius, z], [x + radius, z]] as const) {
      for (const side of [-1, 1]) {
        const px = gx + (gx === x ? side * (gateHalfWidth + 1) : 0);
        const pz = gz + (gz === z ? side * (gateHalfWidth + 1) : 0);
        if (px < chunkMinX || px > chunkMaxX || pz < chunkMinZ || pz > chunkMaxZ) continue;
        for (let y = ground; y < ground + height + 1; y += 1) writer.set(px, y, pz, ID.stone_bricks);
      }
    }
  };

  const stampTownFortifications = (x: number, z: number, ground: number): void => {
    const radius = 48;
    const wallHeight = 8;
    stampRingWithGates(x, z, radius, ground, wallHeight, ID.stone_bricks, 2);

    // Four corner towers rise above the curtain wall. Their hollow centres and
    // narrow arrow slits keep them readable as towers rather than solid pillars.
    const stampTower = (cx: number, cz: number, half: number, height: number): void => {
      const minX = Math.max(cx - half, chunkMinX);
      const maxX = Math.min(cx + half, chunkMaxX);
      const minZ = Math.max(cz - half, chunkMinZ);
      const maxZ = Math.min(cz + half, chunkMaxZ);
      if (minX > maxX || minZ > maxZ) return;
      for (let px = minX; px <= maxX; px += 1) {
        for (let pz = minZ; pz <= maxZ; pz += 1) {
          const dx = Math.abs(px - cx);
          const dz = Math.abs(pz - cz);
          const edge = Math.max(dx, dz) === half;
          if (!edge) continue;
          for (let y = ground; y < ground + height; y += 1) {
            const slit = y === ground + 4 && ((dx === half && dz === 0) || (dz === half && dx === 0));
            if (!slit) writer.set(px, y, pz, ID.stone_bricks);
          }
          if (px === cx && pz === cz) {
            writer.set(px, ground + height, pz, ID.dark_planks);
          }
        }
      }
      // Alternating merlons on the tower roofline.
      const top = ground + height;
      for (let offset = -half; offset <= half; offset += 2) {
        for (const [px, pz] of [[cx + offset, cz - half], [cx + offset, cz + half],
          [cx - half, cz + offset], [cx + half, cz + offset]] as const) {
          if (px >= chunkMinX && px <= chunkMaxX && pz >= chunkMinZ && pz <= chunkMaxZ) {
            writer.set(px, top, pz, ID.stone_bricks);
            writer.set(px, top + 1, pz, ID.stone_bricks);
          }
        }
      }
    };

    for (const dx of [-radius, radius]) {
      for (const dz of [-radius, radius]) stampTower(x + dx, z + dz, 4, 12);
    }

    // Paired gate towers flank each open cardinal entrance. A lintel spans
    // above head height so the gate reads as a gatehouse while remaining walkable.
    for (const [gx, gz, horizontal] of [
      [x, z - radius, true], [x, z + radius, true],
      [x - radius, z, false], [x + radius, z, false],
    ] as const) {
      for (const side of [-1, 1]) {
        const tx = gx + (horizontal ? side * 6 : 0);
        const tz = gz + (horizontal ? 0 : side * 6);
        stampTower(tx, tz, 3, 11);
      }
      if (horizontal) {
        for (let px = Math.max(x - 2, chunkMinX); px <= Math.min(x + 2, chunkMaxX); px += 1) {
          if (gz < chunkMinZ || gz > chunkMaxZ) continue;
          for (let y = ground + 7; y <= ground + 8; y += 1) writer.set(px, y, gz, ID.stone_bricks);
        }
      } else {
        for (let pz = Math.max(z - 2, chunkMinZ); pz <= Math.min(z + 2, chunkMaxZ); pz += 1) {
          if (gx < chunkMinX || gx > chunkMaxX) continue;
          for (let y = ground + 7; y <= ground + 8; y += 1) writer.set(gx, y, pz, ID.stone_bricks);
        }
      }
    }
  };

  for (const node of nodes) {
    const x = Math.round(node.x);
    const z = Math.round(node.z);

    if (node.level === "city") {
      if (node.metadata.placementValid === true) {
        const ground = Number(node.metadata.resolvedGround);
        const nearby = Math.abs(x - chunkMinX) <= 520 + CHUNK_SIZE && Math.abs(z - chunkMinZ) <= 520 + CHUNK_SIZE;
        if (nearby && Number.isFinite(ground)) {
          const plazaRadius = 15;
          for (let px = Math.max(x - plazaRadius, chunkMinX); px <= Math.min(x + plazaRadius, chunkMaxX); px += 1) {
            for (let pz = Math.max(z - plazaRadius, chunkMinZ); pz <= Math.min(z + plazaRadius, chunkMaxZ); pz += 1) {
              if (Math.abs(px - x) <= 9 && Math.abs(pz - z) <= 8) continue;
              writer.set(px, ground, pz, ID.stone_bricks);
              writer.set(px, ground + 1, pz, 0);
            }
          }
          const hall: Building = {
            x, z, w: 19, d: 17, wall: 18, stories: 3, facing: 0, roof: "hip",
            wallBlock: ID.stone_bricks, frameBlock: ID.dark_planks, roofBlock: ID.roof,
            floorBlock: ID.stone_bricks, foundation: ID.stone_bricks, chimney: ID.cobblestone,
            glazed: true, blueprint: "hierarchy-city-hall", accent: ID.dark_planks,
            open: false, turret: 1, spire: false, forge: false, furniture: 2,
          };
          stampBuilding(writer, hall, ground);
        }
      }
      for (const townId of node.children) {
        const town = byId.get(townId);
        if (node.metadata.placementValid === true && town?.level === "town" && town.metadata.placementValid === true) {
          stampRoad(x, z, Math.round(town.x), Math.round(town.z), 5);
        }
      }
      continue;
    }

    if (node.level === "town") {
      if (node.metadata.placementValid !== true) continue;
      const ground = Number(node.metadata.resolvedGround);
      if (!Number.isFinite(ground)) continue;
      for (const villageId of node.children) {
        const village = byId.get(villageId);
        if (village?.level === "village" && village.metadata.placementValid === true) {
          stampRoad(x, z, Math.round(village.x), Math.round(village.z), 3);
        }
      }
      const plazaRadius = 11;
      for (let px = Math.max(x - plazaRadius, chunkMinX); px <= Math.min(x + plazaRadius, chunkMaxX); px += 1) {
        for (let pz = Math.max(z - plazaRadius, chunkMinZ); pz <= Math.min(z + plazaRadius, chunkMaxZ); pz += 1) {
          if (Math.abs(px - x) <= 8 && Math.abs(pz - z) <= 7) continue;
          writer.set(px, ground, pz, ID.stone_bricks);
          writer.set(px, ground + 1, pz, 0);
        }
      }
      stampTownFortifications(x, z, ground);
      const hall: Building = {
        x, z, w: 15, d: 13, wall: 12, stories: 2, facing: 0, roof: "hip",
        wallBlock: ID.cobblestone, frameBlock: ID.dark_planks, roofBlock: ID.roof,
        floorBlock: ID.stone_bricks, foundation: ID.stone_bricks, chimney: ID.cobblestone,
        glazed: true, blueprint: "hierarchy-town-hall", accent: ID.dark_planks,
        open: false, turret: 0, spire: false, forge: false, furniture: 2,
      };
      stampBuilding(writer, hall, ground);
      continue;
    }

    if (node.level === "castle") {
      if (node.metadata.placementValid !== true) continue;
      const searchRadius = Number(node.metadata.strategicRadius) || 160;
      if (Math.abs(x - chunkMinX) > searchRadius + 72 + CHUNK_SIZE ||
          Math.abs(z - chunkMinZ) > searchRadius + 72 + CHUNK_SIZE) continue;
      const archetype = String(node.metadata.archetype ?? "concentric");
      const castleX = x;
      const castleZ = z;
      const ground = Number(node.metadata.resolvedGround);
      if (!Number.isFinite(ground)) continue;
      const style = castleLayout(archetype);

      if (style.moat) {
        const moatRadius = style.outerRadius + 3;
        const minX = Math.max(castleX - moatRadius, chunkMinX);
        const maxX = Math.min(castleX + moatRadius, chunkMaxX);
        const minZ = Math.max(castleZ - moatRadius, chunkMinZ);
        const maxZ = Math.min(castleZ + moatRadius, chunkMaxZ);
        for (let px = minX; px <= maxX; px += 1) for (let pz = minZ; pz <= maxZ; pz += 1) {
          if (Math.max(Math.abs(px - castleX), Math.abs(pz - castleZ)) !== moatRadius) continue;
          const dx = px - castleX; const dz = pz - castleZ;
          if ((Math.abs(dx) <= 3 && Math.abs(dz) >= style.outerRadius - 1) ||
              (Math.abs(dz) <= 3 && Math.abs(dx) >= style.outerRadius - 1)) continue;
          writer.set(px, ground - 1, pz, ID.water);
          writer.set(px, ground - 2, pz, ID.water);
          writer.set(px, ground - 3, pz, ID.gravel);
        }
      }

      stampRingWithGates(castleX, castleZ, style.outerRadius, ground, style.outerHeight, ID.stone_bricks, style.gateHalfWidth);
      if (style.innerRadius > 0) {
        stampRingWithGates(castleX, castleZ, style.innerRadius, ground + style.innerRise, style.innerHeight, ID.stone_bricks, 2);
      }
      if (style.keepRadius > 0) {
        stampRingWithGates(castleX, castleZ, style.keepRadius, ground + style.keepRise, style.keepHeight, ID.stone_bricks, 2);
      }
      for (const dx of [-style.outerRadius, style.outerRadius]) {
        for (const dz of [-style.outerRadius, style.outerRadius]) {
          stampCastleTower(writer, castleX + dx, castleZ + dz, ground, style.towerHalf, style.outerHeight + style.towerExtra);
        }
      }
      if (style.gateTowers) {
        for (const [dx, dz] of [[0, -style.outerRadius], [0, style.outerRadius], [-style.outerRadius, 0], [style.outerRadius, 0]] as const) {
          stampCastleTower(writer, castleX + dx, castleZ + dz, ground, 3, style.outerHeight + 5);
        }
      }
      const keep: Building = {
        x: castleX, z: castleZ, w: style.keepSize, d: style.keepSize,
        wall: style.keepWall, stories: Math.max(2, Math.floor(style.keepWall / 6)),
        facing: 0, roof: archetype === "palace-fortress" ? "dome" : "hip",
        wallBlock: archetype === "riverside" ? ID.cobblestone : ID.stone_bricks,
        frameBlock: archetype === "palace-fortress" ? ID.marble : ID.dark_planks,
        roofBlock: archetype === "palace-fortress" ? ID.marble : ID.roof,
        floorBlock: ID.stone_bricks, foundation: ID.stone_bricks, chimney: ID.cobblestone,
        glazed: true, blueprint: `hierarchy-castle-${archetype}-keep`,
        accent: archetype === "palace-fortress" ? ID.gold : ID.dark_planks,
        open: false, turret: archetype === "palace-fortress" ? 4 : 1,
        spire: false, forge: false, furniture: 2,
      };
      stampBuilding(writer, keep, ground + style.keepRise);
      continue;
    }

    if (node.level !== "house") continue;
    if (node.metadata.placementValid !== true) continue;
    const archetype = Math.max(0, Math.min(HOUSE_BLUEPRINTS.length - 1, Math.floor(Number(node.metadata.archetypeIndex) || 0)));
    const blueprintIds = HOUSE_BLUEPRINTS;
    const bp = blueprintById("village", blueprintIds[archetype]);
    const halfW = Math.ceil(bp.w / 2);
    const halfD = Math.ceil(bp.d / 2);
    const siteX = x;
    const siteZ = z;
    const ground = Number(node.metadata.resolvedGround);
    if (!Number.isFinite(ground)) continue;
    if (siteX + halfW < chunkMinX || siteX - halfW > chunkMaxX ||
        siteZ + halfD < chunkMinZ || siteZ - halfD > chunkMaxZ) continue;

    // Use the same blueprint roster as hand-designed villages, so hierarchy
    // homes inherit their real footprints, wall palettes, roof forms and facades.
    const palette = tierPalette("village", bp.style);
    const building = applyVictorianFacade({
      x: siteX, z: siteZ, w: bp.w, d: bp.d, wall: bp.stories * 6, stories: bp.stories,
      facing: archetype % 4 as Facing, roof: bp.roof,
      wallBlock: pickFrom(palette.walls, hash2(siteX, siteZ, seed + archetype * 37)),
      frameBlock: palette.frame, roofBlock: tierRoofBlock("village"),
      floorBlock: palette.floor, foundation: palette.foundation,
      chimney: bp.chimney || bp.forge ? ID.cobblestone : 0, glazed: true,
      blueprint: `hierarchy-${bp.id}`, accent: accentBlock(bp.accent),
      open: !!bp.open, turret: bp.turret ?? 0, spire: !!bp.spire,
      forge: !!bp.forge, passage: bp.passage, furniture: bp.furniture,
    }, bp.facadeVariant, bp.windowCount, bp.corniceBlock, bp.gableTrim, bp.hasDormers, bp.bayWindowWidth);
    stampBuilding(writer, building, ground);
  }
}