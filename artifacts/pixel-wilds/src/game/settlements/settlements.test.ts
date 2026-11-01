import assert from "node:assert/strict";
import test from "node:test";

import { ChunkWriter } from "../chunk";
import { getTerrain } from "../world";
import { furnishInterior, stairCells } from "./furnish";
import { makeSettlement, type Building } from "./plan";
import { stampBuilding } from "./stamp";

test("settlement planning is deterministic and validates its own footprint", () => {
  const terrain = getTerrain(4242);
  const first = makeSettlement(terrain, 4242, 0, 0);
  const second = makeSettlement(getTerrain(4242), 4242, 0, 0);
  assert.ok(first, "the origin region should produce a settlement");
  assert.deepEqual(first, second, "planning is a pure function of terrain and seed");
  assert.ok(first.name.length > 0);
  assert.ok(first.radius > 0);
  assert.equal(first.inhabitants.length, 0, "settlements remain architecture-only");
  for (const building of first.buildings) {
    assert.ok(Number.isFinite(building.x) && Number.isFinite(building.z));
    assert.ok(building.w >= 3 && building.d >= 3);
    assert.ok(building.wall >= 0 && building.stories >= 1);
    assert.ok(
      Math.abs(building.x - first.centerX) <= first.radius + 2 ||
        Math.abs(building.z - first.centerZ) <= first.radius + 2,
      `${building.blueprint} should stay near its settlement`,
    );
  }
});

test("stairs are inside the building and furniture never occupies a step", () => {
  const building: Building = {
    x: 10,
    z: 10,
    w: 9,
    d: 9,
    wall: 12,
    stories: 2,
    facing: 0,
    roof: "gable",
    wallBlock: 1,
    frameBlock: 1,
    roofBlock: 1,
    floorBlock: 1,
    foundation: 1,
    chimney: 1,
    glazed: true,
    blueprint: "test",
    accent: 0,
    open: false,
    turret: 0,
    spire: false,
    forge: false,
    furniture: 2,
  };
  const stairs = stairCells(building, 20);
  assert.equal(stairs.length, 6);
  for (const cell of stairs) {
    assert.ok(Math.abs(cell.x - building.x) <= (building.w - 1) / 2);
    assert.ok(Math.abs(cell.z - building.z) <= (building.d - 1) / 2);
  }

  const written = new Map<string, number>();
  const writer = {
    inside: (x: number, z: number) => Math.abs(x - 10) <= 4 && Math.abs(z - 10) <= 4,
    set: (x: number, y: number, z: number, id: number) => written.set(`${x},${y},${z}`, id),
  };
  furnishInterior(writer as never, building, 20, new Set(stairs.map((cell) => `${cell.x},${cell.y},${cell.z}`)));
  const stairKeys = new Set(stairs.map((cell) => `${cell.x},${cell.y + 1},${cell.z}`));
  for (const key of written.keys()) {
    assert.equal(stairKeys.has(key), false, "furniture skipped the stairwell");
  }
});

test("the stamping module writes a deterministic building slice", () => {
  const building: Building = {
    x: 8,
    z: 8,
    w: 7,
    d: 7,
    wall: 6,
    stories: 1,
    facing: 0,
    roof: "gable",
    wallBlock: 1,
    frameBlock: 1,
    roofBlock: 1,
    floorBlock: 1,
    foundation: 1,
    chimney: 1,
    glazed: true,
    blueprint: "stamp-test",
    accent: 0,
    open: false,
    turret: 0,
    spire: false,
    forge: false,
    furniture: 1,
  };
  const chunk = {
    cx: 0,
    cz: 0,
    blocks: new Uint8Array(16 * 16 * 256),
    version: 0,
    maxY: 0,
    solidCount: 0,
  };
  stampBuilding(new ChunkWriter(chunk), building, 10);
  assert.ok(chunk.blocks.some((id) => id !== 0), "the chunk receives the building shell");
  assert.notEqual(chunk.blocks[(8 * 16 + 8) * 256 + 10], 0, "the floor is stamped");
});
