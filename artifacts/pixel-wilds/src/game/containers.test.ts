import assert from "node:assert/strict";
import test from "node:test";

import { createInventory } from "./player/inventory";
import {
  CONTAINER_SLOT_COUNTS,
  containerCapacity,
  containerKey,
  containerSaveKey,
  containerTotal,
  createContainer,
  deposit,
  furnaceDeposit,
  readContainers,
  saveContainers,
  tickFurnace,
  tickHoppers,
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
  const packed = deposit(createContainer("chest"), inventory, "stone", 4);
  assert.equal(packed.moved, 4);
  assert.equal(packed.container.contents.stone, 4);
  assert.equal(packed.inventory.stone, 6);
  assert.equal(inventory.stone, 10);

  const taken = withdraw(packed.container, packed.inventory as typeof inventory, "stone", 3);
  assert.equal(taken.container.contents.stone, 1);
  assert.equal(taken.inventory.stone, 9);
  assert.equal(withdraw(taken.container, taken.inventory as typeof inventory, "wood", 1).moved, 0);
});

test("a chest never exceeds its stack-slot capacity", () => {
  const inventory = createInventory("survival");
  inventory.dirt = containerCapacity("chest") + 10;
  const packed = deposit(createContainer("chest"), inventory, "dirt", containerCapacity("chest"));
  assert.equal(packed.moved, containerCapacity("chest"));
  assert.equal(containerTotal(packed.container), containerCapacity("chest"));
  assert.equal(containerTotal(packed.container), CONTAINER_SLOT_COUNTS.chest * 64);

  const full = deposit(packed.container, packed.inventory, "stone", 1);
  assert.equal(full.moved, 0);
  assert.equal(full.blocked, true);
});

test("chests save per world by block position and migrate the old v1 format", () => {
  const storage = new MemoryStorage();
  const key = containerKey({ x: 4, y: 12, z: -3 });
  assert.equal(key, "4,12,-3");
  assert.equal(containerSaveKey("world-a"), `${CONTAINER_SAVE_PREFIX}world-a`);

  const chest = createContainer("chest");
  chest.contents = { planks: 3 };
  assert.equal(saveContainers("world-a", { [key]: chest }, storage), true);
  assert.deepEqual(readContainers("world-a", storage), { [key]: chest });
  assert.deepEqual(readContainers("world-b", storage), {});

  storage.setItem(containerSaveKey("world-a"), JSON.stringify({
    version: 1,
    containers: {
      [key]: { planks: 2, mystery: 4 },
      "not-a-cell": { stone: 1 },
    },
  }));
  assert.deepEqual(readContainers("world-a", storage), {
    [key]: { kind: "chest", contents: { planks: 2 } },
  });

  saveContainers("world-a", {}, storage);
  assert.equal(storage.getItem(containerSaveKey("world-a")), null);
});

test("a furnace consumes fuel, smelts a stack and keeps its slots separate", () => {
  const inventory = createInventory("survival");
  inventory.sand = 2;
  inventory.coal_ore = 1;
  let container = createContainer("furnace");
  const loaded = furnaceDeposit(container, inventory, "sand", 2);
  const fuelled = furnaceDeposit(loaded.container, loaded.inventory as typeof inventory, "coal_ore", 1);
  container = fuelled.container;

  for (let tick = 0; tick < 40; tick += 1) container = tickFurnace(container, 0.5);
  assert.equal(container.furnace?.inputCount, 1);
  assert.equal(container.furnace?.output, "glass");
  assert.equal(container.furnace?.outputCount, 1);
  assert.equal(container.furnace?.fuelCount, 0);
  assert.ok(container.furnace?.burn !== undefined);
});

test("hoppers pull from above and push into the container below", () => {
  const aboveKey = containerKey({ x: 0, y: 10, z: 0 });
  const hopperKey = containerKey({ x: 0, y: 9, z: 0 });
  const belowKey = containerKey({ x: 0, y: 8, z: 0 });
  const above = createContainer("chest");
  above.contents.stone = 2;
  const hopper = createContainer("hopper");
  const below = createContainer("barrel");
  const next = tickHoppers({
    [aboveKey]: above,
    [hopperKey]: hopper,
    [belowKey]: below,
  });

  assert.equal(next[aboveKey].contents.stone, 1);
  assert.equal(next[belowKey].contents.stone, 1);
  assert.equal(next[hopperKey].contents.stone, undefined, "the hopper relays rather than hoards");
});
