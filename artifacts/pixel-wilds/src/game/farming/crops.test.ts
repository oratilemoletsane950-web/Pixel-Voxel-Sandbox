import assert from "node:assert/strict";
import test from "node:test";

import type { KeyValueStorage } from "../storage";
import { createContainer, furnaceDeposit, furnaceWithdraw, tickFurnace } from "../containers";
import { createWorld, getBlock, setBlock } from "../world";
import {
  cropGrowth,
  cropStage,
  createCropField,
  harvestCrop,
  plantCrop,
  syncCropField,
  wildWheatYield,
} from "./crops";
import { readCropField, saveCropField, MAX_CROPS } from "./persistence";

class MemoryStorage implements KeyValueStorage {
  private readonly entries = new Map<string, string>();
  get length() { return this.entries.size; }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string) { this.entries.set(key, value); }
  removeItem(key: string) { this.entries.delete(key); }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
}

test("wheat can only be planted above farmland and ripens on world time", () => {
  const bare = createWorld(42, 0, 0, 1);
  const world = setBlock(setBlock(createWorld(42, 0, 0, 1), 2, 40, 2, "farmland"), 2, 41, 2, null);
  const cellY = 41;
  assert.equal(plantCrop(createCropField(), bare, 2, cellY, 2, 0, "wheat").planted, false);

  const planted = plantCrop(createCropField(), world, 2, cellY, 2, 100, "wheat");
  assert.equal(planted.planted, true);
  assert.equal(planted.field.records.length, 1);
  assert.equal(cropStage(planted.field.records[0], 100), "sprout");
  assert.equal(cropGrowth(planted.field.records[0], 100 + 75), 1);
  assert.equal(cropStage(planted.field.records[0], 100 + 75), "ripe");
  assert.equal(plantCrop(planted.field, world, 2, cellY, 2, 120).reason, "occupied");
});

test("growth wraps safely across midnight and sync writes stage blocks", () => {
  const world = setBlock(setBlock(createWorld(42, 0, 0, 1), 2, 40, 2, "farmland"), 2, 41, 2, null);
  const planted = plantCrop(createCropField(), world, 2, 41, 2, 710);
  const withSprout = setBlock(planted.field.records.length ? world : world, 2, 41, 2, "wheat_sprout");
  const early = syncCropField(planted.field, withSprout, 715);
  assert.equal(getBlock(early.world, 2, 41, 2), "wheat_sprout");
  assert.equal(early.changed, false);

  const mature = syncCropField(planted.field, withSprout, 70); // wrapped past 720
  assert.equal(mature.changed, true);
  assert.equal(getBlock(mature.world, 2, 41, 2), "wheat_ripe");

  const harvested = harvestCrop(mature.field, 2, 41, 2, 70);
  assert.equal(harvested.stage, "ripe");
  assert.deepEqual(harvested.yields, [
    { item: "wheat_grain", count: 3 },
    { item: "wheat_seeds", count: 1 },
  ]);
  assert.equal(harvested.field.records.length, 0);
  assert.deepEqual(wildWheatYield(), [
    { item: "wheat_grain", count: 2 },
    { item: "wheat_seeds", count: 1 },
  ]);
});

test("wheat grain bakes into bread in the existing furnace", () => {
  let furnace = createContainer("furnace");
  const loaded = furnaceDeposit(furnace, { wheat_grain: 2, wood: 1 }, "wheat_grain", 2);
  assert.equal(loaded.moved, 2);
  furnace = furnaceDeposit(loaded.container, loaded.inventory, "wood", 1).container;
  for (let second = 0; second < 12; second += 1) furnace = tickFurnace(furnace, 1);
  assert.equal(furnace.furnace?.output, "bread");
  assert.equal(furnace.furnace?.outputCount, 1);
  const taken = furnaceWithdraw(furnace, {}, 1);
  assert.equal(taken.moved, 1);
  assert.equal(taken.inventory.bread, 1);
});

test("crop saves round-trip, reject bad entries and prune lost soil", () => {
  const storage = new MemoryStorage();
  const field = createCropField([
    { kind: "wheat", x: 1, y: 41, z: 2, plantedAt: 10 },
    { kind: "wheat", x: 1, y: 41, z: 2, plantedAt: 20 },
  ]);
  assert.equal(field.records.length, 1, "duplicate positions are rejected");
  assert.equal(saveCropField("world", field, storage), true);
  assert.deepEqual(readCropField("world", storage), field);

  storage.setItem(
    "pixel-wilds-crops-v1:bad",
    JSON.stringify({ version: 1, crops: [{ kind: "wheat", x: 1.5, y: 2, z: 3, plantedAt: 4 }] }),
  );
  assert.equal(readCropField("bad", storage).records.length, 0);
  storage.setItem("pixel-wilds-crops-v1:broken", "{oops");
  assert.equal(readCropField("broken", storage).records.length, 0);

  const many = Array.from({ length: MAX_CROPS + 20 }, (_, index) => ({
    kind: "wheat" as const,
    x: index,
    y: 40,
    z: 0,
    plantedAt: 0,
  }));
  assert.equal(createCropField(many).records.length, MAX_CROPS + 20);
  assert.equal(saveCropField("capped", createCropField(many), storage), true);
  assert.equal(readCropField("capped", storage).records.length, MAX_CROPS);

  const world = createWorld(42, 0, 0, 1);
  const planted = plantCrop(createCropField(), setBlock(world, 2, 40, 2, "farmland"), 2, 41, 2, 0);
  const pruned = syncCropField(planted.field, setBlock(planted.field.records.length ? world : world, 2, 40, 2, "stone"), 1);
  assert.equal(pruned.field.records.length, 0);
});
