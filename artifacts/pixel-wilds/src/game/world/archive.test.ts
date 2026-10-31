import assert from "node:assert/strict";
import test from "node:test";

import { containerKey, readContainers, saveContainers } from "../containers";
import { createDropField, readDropSave, saveDropState } from "../player/drops";
import { createInventory, readPlayerSave, savePlayer } from "../player/inventory";
import { createSurvivalState, readSurvivalSave, saveSurvival } from "../player/survival";
import { createToolState, readToolState, saveToolState } from "../player/tools";
import {
  CONTAINER_SAVE_PREFIX,
  DROP_SAVE_PREFIX,
  PLAYER_SAVE_PREFIX,
  SURVIVAL_SAVE_PREFIX,
  TOOL_SAVE_PREFIX,
  WORLD_CLOCK_PREFIX,
  WORLD_DATA_PREFIX,
  type KeyValueStorage,
} from "../storage";
import {
  MAX_WORLD_ARCHIVE_CHARACTERS,
  WorldArchiveError,
  createWorld,
  createWorldArchive,
  createWorldProfile,
  getBlock,
  importWorldArchive,
  listWorldProfiles,
  loadWorldData,
  readWorldClock,
  saveWorldClock,
  saveWorldData,
  saveWorldProfile,
  serializeWorldArchive,
  setBlock,
  WORLD_SAVE_SLOTS,
} from "./index";

class MemoryStorage implements KeyValueStorage {
  private readonly entries = new Map<string, string>();
  get length() { return this.entries.size; }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string) { this.entries.set(key, value); }
  removeItem(key: string) { this.entries.delete(key); }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
}

function createFullWorld(storage: MemoryStorage) {
  const profile = createWorldProfile({
    id: "source-world",
    name: "Source Wilderness",
    seed: 321,
    mode: "survival",
    difficulty: "hard",
    now: 10_000,
  });
  saveWorldProfile(profile, storage);

  const terrain = setBlock(createWorld(321, 0, 0, 1), 4, 40, 4, "brick");
  saveWorldData(profile.id, terrain, storage);

  const inventory = createInventory("survival");
  inventory.gold = 7;
  savePlayer(profile.id, inventory, { x: 1, y: 2, z: 3 }, storage);

  const survival = createSurvivalState();
  survival.health = 13;
  survival.berries = 4;
  saveSurvival(profile.id, survival, storage);

  saveWorldClock(profile.id, 321, storage);

  const tools = createToolState();
  tools.belt.wood_pickaxe = 12;
  tools.equipped = "wood_pickaxe";
  saveToolState(profile.id, tools, storage);

  const drops = createDropField();
  drops.spawn("gold", { x: 2, y: 41, z: 2 });
  saveDropState(profile.id, drops, storage);

  saveContainers(profile.id, {
    [containerKey({ x: 2, y: 40, z: 2 })]: { gold: 5, planks: 3 },
  }, storage);

  return profile;
}

test("a world archive contains every per-world save and imports under a new id", () => {
  const storage = new MemoryStorage();
  const source = createFullWorld(storage);
  const archive = createWorldArchive(source.id, storage);
  assert.ok(archive);
  assert.equal(archive.format, "pixel-wilds-world");
  assert.equal(archive.version, 1);
  assert.deepEqual(
    WORLD_SAVE_SLOTS.map((slot) => Boolean(archive.saves[slot.id])),
    WORLD_SAVE_SLOTS.map(() => true),
    "every registered save slot is present",
  );

  const serialized = serializeWorldArchive(archive);
  const imported = importWorldArchive(serialized, storage, { now: 20_000 });
  assert.notEqual(imported.id, source.id);
  assert.equal(imported.name, "Source Wilderness (imported)");
  assert.equal(imported.seed, source.seed);
  assert.equal(imported.mode, "survival");
  assert.equal(imported.difficulty, "hard");
  assert.deepEqual(imported.rules, source.rules);
  assert.equal(listWorldProfiles(storage).length, 2);

  const terrain = loadWorldData(imported.id, imported.seed, 4, 4, 1, storage);
  assert.equal(getBlock(terrain, 4, 40, 4), "brick");
  assert.equal(readPlayerSave(imported.id, storage)?.inventory.gold, 7);
  assert.deepEqual(readPlayerSave(imported.id, storage)?.position, { x: 1, y: 2, z: 3 });
  assert.equal(readSurvivalSave(imported.id, storage)?.health, 13);
  assert.equal(readWorldClock(imported.id, storage), 321);
  assert.equal(readToolState(imported.id, storage).belt.wood_pickaxe, 12);
  assert.equal(readDropSave(imported.id, storage)[0]?.item, "gold");
  assert.equal(readContainers(imported.id, storage)[containerKey({ x: 2, y: 40, z: 2 })]?.gold, 5);

  // Import copies values; changing the source must not alter the import.
  const changed = createInventory("survival");
  changed.gold = 1;
  savePlayer(source.id, changed, null, storage);
  assert.equal(readPlayerSave(source.id, storage)?.inventory.gold, 1);
  assert.equal(readPlayerSave(imported.id, storage)?.inventory.gold, 7);
});

test("import rejects malformed, oversized and seed-mismatched archives", () => {
  const storage = new MemoryStorage();
  const before = listWorldProfiles(storage).length;
  assert.throws(() => importWorldArchive("{nope", storage), WorldArchiveError);
  assert.throws(() => importWorldArchive("", storage), WorldArchiveError);
  assert.throws(
    () => importWorldArchive("x".repeat(MAX_WORLD_ARCHIVE_CHARACTERS + 1), storage),
    WorldArchiveError,
  );

  const profile = createWorldProfile({ id: "bad", name: "Bad", seed: 9 });
  assert.throws(
    () => importWorldArchive(JSON.stringify({
      format: "something-else",
      version: 1,
      exportedAt: new Date().toISOString(),
      profile,
      saves: {},
    }), storage),
    WorldArchiveError,
  );
  assert.throws(
    () => importWorldArchive(JSON.stringify({
      format: "pixel-wilds-world",
      version: 1,
      exportedAt: new Date().toISOString(),
      profile,
      saves: {
        data: JSON.stringify({ version: 1, seed: 10, edits: {} }),
      },
    }), storage),
    WorldArchiveError,
    "terrain must belong to the archived seed",
  );
  assert.equal(listWorldProfiles(storage).length, before, "failed imports never create a visible world");
});

test("save-slot prefixes cover all separate world files", () => {
  const expected = [
    WORLD_DATA_PREFIX,
    PLAYER_SAVE_PREFIX,
    SURVIVAL_SAVE_PREFIX,
    WORLD_CLOCK_PREFIX,
    TOOL_SAVE_PREFIX,
    DROP_SAVE_PREFIX,
    CONTAINER_SAVE_PREFIX,
  ];
  assert.deepEqual(WORLD_SAVE_SLOTS.map((slot) => slot.prefix), expected);
});
