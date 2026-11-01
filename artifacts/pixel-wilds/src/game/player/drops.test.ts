import assert from "node:assert/strict";
import test from "node:test";

import { createWorld } from "../world";
import { PLAYER_EYE_HEIGHT } from "../world/types";
import { findColumnTop } from "./aiming";
import {
  DROP_HALF_SIZE,
  DROP_PICKUP_DELAY,
  MAX_DROPS,
  createDropField,
  dropSaveKey,
  readDropSave,
  saveDropState,
} from "./drops";
import { DROP_SAVE_PREFIX, type KeyValueStorage } from "../storage";
import { collectBlockRewards } from "../items/rewards";

class MemoryStorage implements KeyValueStorage {
  private readonly entries = new Map<string, string>();
  get length() { return this.entries.size; }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string) { this.entries.set(key, value); }
  removeItem(key: string) { this.entries.delete(key); }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
}

function ground() {
  const world = createWorld(2_026_1031, 0, 0, 1);
  const top = findColumnTop(world, 0, 0);
  assert.ok(top, "the test world needs a surface block");
  return { world, x: 0, z: 0, surface: top.y + 1, topY: top.y };
}

function settle(field: ReturnType<typeof createDropField>, world: ReturnType<typeof createWorld>) {
  const player = { x: 20, y: 60, z: 20 };
  for (let tick = 0; tick < 180; tick += 1) field.tick(world, player, 1 / 60);
}

test("a block drop falls, settles on the surface and keeps its identity", () => {
  const { world, x, z, surface, topY } = ground();
  const field = createDropField();
  const drop = field.spawn("stone", { x, y: topY, z });
  assert.ok(drop);
  assert.equal(drop.item, "stone");
  assert.equal(field.items.length, 1);

  settle(field, world);
  assert.equal(drop.settled, true);
  assert.ok(Math.abs(drop.y - (surface + DROP_HALF_SIZE)) < 0.06, `settled at ${drop.y}`);
  assert.ok(drop.x > x && drop.x < x + 1);
  assert.ok(drop.z > z && drop.z < z + 1);
});

test("a full drop field stores rewards in the inventory instead of losing them", () => {
  const field = createDropField();
  const cell = { x: 4, y: 10, z: 4 };
  for (let index = 0; index < MAX_DROPS; index += 1) {
    assert.ok(field.spawn("stone", cell));
  }
  assert.equal(field.items.length, MAX_DROPS);

  const result = collectBlockRewards(field, { stone: 2 }, [{ item: "wheat_grain", count: 3 }], cell);
  assert.equal(result.dropped, 0);
  assert.equal(result.gathered, 3);
  assert.equal(result.inventory.wheat_grain, 3);
  assert.equal(result.inventory.stone, 2, "unrelated inventory counts are preserved");
  assert.equal(field.items.length, MAX_DROPS, "the visible field stays capped");
});

test("pickup waits for the spin-up delay and then collects the drop", () => {
  const { world, x, z, surface, topY } = ground();
  const field = createDropField();
  const drop = field.spawn("clay", { x, y: topY, z });
  assert.ok(drop);
  const player = { x: drop.x, y: surface + PLAYER_EYE_HEIGHT, z: drop.z };

  for (let tick = 0; tick < Math.ceil(DROP_PICKUP_DELAY * 60) - 2; tick += 1) {
    assert.deepEqual(field.tick(world, player, 1 / 60), []);
  }
  assert.equal(field.items.length, 1, "a freshly broken block is not vacuumed instantly");

  let collected = field.tick(world, player, 0.1);
  for (let tick = 0; tick < 6 && collected.length === 0; tick += 1) {
    collected = field.tick(world, player, 1 / 60);
  }
  assert.deepEqual(collected.map((item) => item.item), ["clay"]);
  assert.equal(field.items.length, 0);
});

test("the drop field caps itself without losing the block elsewhere", () => {
  const { x, z, topY } = ground();
  const field = createDropField();
  for (let index = 0; index < MAX_DROPS; index += 1) {
    assert.ok(field.spawn("dirt", { x, y: topY + index, z }));
  }
  assert.equal(field.items.length, MAX_DROPS);
  assert.equal(field.spawn("dirt", { x, y: topY, z }), null);
});

test("drops save per world and restore only valid items", () => {
  const storage = new MemoryStorage();
  const { x, z, topY } = ground();
  const field = createDropField();
  field.spawn("stone", { x, y: topY, z });
  field.spawn("planks", { x, y: topY, z });
  assert.equal(saveDropState("world-a", field, storage), true);
  assert.equal(dropSaveKey("world-a"), `${DROP_SAVE_PREFIX}world-a`);

  const restored = createDropField(readDropSave("world-a", storage));
  assert.deepEqual(restored.items.map((drop) => drop.item), ["stone", "planks"]);
  assert.deepEqual(readDropSave("world-b", storage), []);

  storage.setItem(dropSaveKey("world-a"), JSON.stringify({
    version: 1,
    drops: [
      { item: "moon_rock", x: 1, y: 2, z: 3 },
      { item: "stone", x: 1, y: 2, z: 3 },
      { item: "dirt", x: "not a number", y: 2, z: 3 },
    ],
  }));
  assert.deepEqual(readDropSave("world-a", storage).map((drop) => drop.item), ["stone"]);

  storage.setItem(dropSaveKey("world-a"), "{not json");
  assert.deepEqual(readDropSave("world-a", storage), []);
  saveDropState("world-a", createDropField(), storage);
  assert.equal(storage.getItem(dropSaveKey("world-a")), null);
});
