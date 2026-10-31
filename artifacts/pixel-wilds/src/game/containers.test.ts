import assert from "node:assert/strict";
import test from "node:test";

import { createInventory } from "./player/inventory";
import {
  CONTAINER_CAPACITY,
  containerKey,
  containerSaveKey,
  containerTotal,
  deposit,
  readContainers,
  saveContainers,
  withdraw,
} from "./containers";
import { CONTAINER_SAVE_PREFIX, type KeyValueStorage } from "./storage";

class MemoryStorage implements KeyValueStorage {
  private readonly entries = new Map<string, string>();
  get length() { return this.entries.size; }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string) { this.entries.set(key, value); }
  removeItem(key: string) { this.entries.delete(key); }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
}

test("deposit and withdraw move counts without mutating their inputs", () => {
  const inventory = createInventory("survival");
  inventory.stone = 10;
  const packed = deposit({}, inventory, "stone", 4);
  assert.equal(packed.moved, 4);
  assert.equal(packed.contents.stone, 4);
  assert.equal(packed.inventory.stone, 6);
  assert.equal(inventory.stone, 10);

  const taken = withdraw(packed.contents, packed.inventory, "stone", 3);
  assert.equal(taken.contents.stone, 1);
  assert.equal(taken.inventory.stone, 9);
  assert.equal(withdraw(taken.contents, taken.inventory, "wood", 1).moved, 0);
});

test("a chest never exceeds capacity and reports a blocked transfer", () => {
  const inventory = createInventory("survival");
  inventory.dirt = CONTAINER_CAPACITY + 10;
  const packed = deposit({}, inventory, "dirt", CONTAINER_CAPACITY);
  assert.equal(packed.moved, CONTAINER_CAPACITY);
  assert.equal(containerTotal(packed.contents), CONTAINER_CAPACITY);

  const full = deposit(packed.contents, packed.inventory, "stone", 1);
  assert.equal(full.moved, 0);
  assert.equal(full.blocked, true);
});

test("chests save per world by block position and reject corrupt entries", () => {
  const storage = new MemoryStorage();
  const key = containerKey({ x: 4, y: 12, z: -3 });
  assert.equal(key, "4,12,-3");
  assert.equal(containerSaveKey("world-a"), `${CONTAINER_SAVE_PREFIX}world-a`);
  assert.equal(saveContainers("world-a", { [key]: { planks: 3 } }, storage), true);

  assert.deepEqual(readContainers("world-a", storage), { [key]: { planks: 3 } });
  assert.deepEqual(readContainers("world-b", storage), {});

  storage.setItem(containerSaveKey("world-a"), JSON.stringify({
    version: 1,
    containers: {
      [key]: { planks: 2, mystery: 4 },
      "not-a-cell": { stone: 1 },
    },
  }));
  assert.deepEqual(readContainers("world-a", storage), { [key]: { planks: 2 } });

  saveContainers("world-a", {}, storage);
  assert.equal(storage.getItem(containerSaveKey("world-a")), null);
});
