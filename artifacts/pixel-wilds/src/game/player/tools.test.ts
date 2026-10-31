import assert from "node:assert/strict";
import test from "node:test";

import { createInventory } from "./inventory";
import {
  TOOL_DEFINITIONS,
  TOOL_BY_ID,
  canCraftTool,
  craftTool,
  createEmptyToolbelt,
  createToolState,
  cycleTool,
  equipTool,
  equippedTool,
  readToolState,
  saveToolState,
  toolSaveKey,
  wearTool,
  type ToolId,
} from "./tools";
import { TOOL_SAVE_PREFIX, type KeyValueStorage } from "../storage";

class MemoryStorage implements KeyValueStorage {
  private readonly entries = new Map<string, string>();
  get length() { return this.entries.size; }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string) { this.entries.set(key, value); }
  removeItem(key: string) { this.entries.delete(key); }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
}

test("the tool catalogue has unique ids and valid recipes", () => {
  assert.equal(TOOL_DEFINITIONS.length, 9);
  assert.equal(new Set(TOOL_DEFINITIONS.map((tool) => tool.id)).size, TOOL_DEFINITIONS.length);
  for (const tool of TOOL_DEFINITIONS) {
    assert.equal(TOOL_BY_ID[tool.id].label, tool.label);
    assert.ok(tool.speed > 1, `${tool.id} must be faster than bare hands`);
    assert.ok(tool.maxDurability > 0, `${tool.id} needs durability`);
    assert.ok(tool.recipe.inputs.length > 0, `${tool.id} needs a recipe`);
    assert.ok(tool.tier >= 1 && tool.tier <= 3, `${tool.id} has a supported tier`);
  }
});

test("crafting a tool spends its inputs and equips a fresh copy", () => {
  const inventory = createInventory("survival");
  inventory.planks = 3;
  inventory.wood = 2;
  const result = craftTool("wood_pickaxe", inventory, createToolState());
  assert.ok(result);
  assert.equal(result.inventory.planks, 0);
  assert.equal(result.inventory.wood, 0);
  assert.equal(result.state.belt.wood_pickaxe, TOOL_BY_ID.wood_pickaxe.maxDurability);
  assert.equal(result.state.equipped, "wood_pickaxe");
  assert.equal(equippedTool(result.state)?.kind, "pickaxe");
});

test("crafting is refused without materials, and creative does not spend stock", () => {
  const empty = createInventory("survival");
  assert.equal(canCraftTool("stone_pickaxe", empty), false);
  assert.equal(craftTool("stone_pickaxe", empty, createToolState()), null);

  const creative = createInventory("survival");
  const result = craftTool("iron_axe", creative, createToolState(), true);
  assert.ok(result);
  assert.equal(result.inventory, creative, "creative crafting leaves the inventory untouched");
  assert.equal(result.state.belt.iron_axe, TOOL_BY_ID.iron_axe.maxDurability);
});

test("wear reduces durability once and brings a broken tool out of hand", () => {
  const inventory = createInventory("survival");
  inventory.stone = 3;
  inventory.planks = 2;
  const crafted = craftTool("stone_pickaxe", inventory, createToolState());
  assert.ok(crafted);

  const worn = wearTool(crafted.state, "stone_pickaxe", 2);
  assert.equal(worn.broke, false);
  assert.equal(worn.state.belt.stone_pickaxe, TOOL_BY_ID.stone_pickaxe.maxDurability - 2);

  const broken = wearTool(worn.state, "stone_pickaxe", 1_000);
  assert.equal(broken.broke, true);
  assert.equal(broken.state.belt.stone_pickaxe, 0);
  assert.equal(broken.state.equipped, null);
  assert.equal(equippedTool(broken.state), null);
});

test("cycling visits bare hands and every usable tool", () => {
  const state = createToolState();
  state.belt.wood_axe = 10;
  state.belt.stone_shovel = 10;
  const first = cycleTool(state);
  assert.equal(first.equipped, "wood_axe");
  assert.equal(cycleTool(first).equipped, "stone_shovel");
  assert.equal(cycleTool(cycleTool(first)).equipped, null);
  assert.equal(equipTool(state, "iron_pickaxe"), state, "cannot equip an unowned tool");
});

test("toolbelts save per world and reject corrupt or excessive values", () => {
  const storage = new MemoryStorage();
  const state = createToolState();
  state.belt.wood_pickaxe = 41;
  state.equipped = "wood_pickaxe";
  assert.equal(saveToolState("world-a", state, storage), true);
  assert.equal(toolSaveKey("world-a"), `${TOOL_SAVE_PREFIX}world-a`);
  assert.ok(storage.getItem(toolSaveKey("world-a")));

  const loaded = readToolState("world-a", storage);
  assert.equal(loaded.belt.wood_pickaxe, 41);
  assert.equal(loaded.equipped, "wood_pickaxe");
  assert.equal(readToolState("world-b", storage).belt.wood_pickaxe, 0, "worlds are isolated");

  storage.setItem(toolSaveKey("world-a"), JSON.stringify({
    belt: { wood_pickaxe: 999_999, iron_axe: -4, mystery: 5 },
    equipped: "stone_pickaxe",
  }));
  const repaired = readToolState("world-a", storage);
  assert.equal(repaired.belt.wood_pickaxe, TOOL_BY_ID.wood_pickaxe.maxDurability);
  assert.equal(repaired.belt.iron_axe, 0);
  assert.equal(repaired.equipped, null, "unowned tools cannot stay equipped");

  storage.setItem(toolSaveKey("world-a"), "{not json");
  const empty = readToolState("world-a", storage);
  assert.deepEqual(empty.belt, createEmptyToolbelt());
  assert.equal(empty.equipped, null);
});
