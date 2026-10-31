import assert from "node:assert/strict";
import test from "node:test";

import { createInventory, readPlayerSave, savePlayer } from "./player/inventory";
import { LEGACY_PLAYER_SAVE_KEY, type KeyValueStorage } from "./storage";
import {
  createWorld,
  createWorldProfile,
  deleteWorldProfile,
  duplicateWorldProfile,
  getBlock,
  getWorldProfile,
  listWorldProfiles,
  loadWorldData,
  renameWorldProfile,
  saveWorld,
  saveWorldData,
  saveWorldProfile,
  setBlock,
  touchWorldProfile,
  WORLD_SAVE_SLOTS,
} from "./world";

class MemoryStorage implements KeyValueStorage {
  private readonly entries = new Map<string, string>();
  get length() { return this.entries.size; }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string) { this.entries.set(key, value); }
  removeItem(key: string) { this.entries.delete(key); }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
}

test("the world registry creates, lists, renames and deletes profiles", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(listWorldProfiles(storage), []);

  const profile = createWorldProfile({
    id: "world-a",
    name: "  Mossy   Hollow  ",
    seed: 42,
    mode: "survival",
    difficulty: "hard",
    now: 1_000,
  });
  assert.equal(profile.name, "Mossy Hollow");

  // Profiles are pure values; the caller decides when they are stored.
  assert.equal(getWorldProfile("world-a", storage), null);
  saveWorldProfile(profile, storage);
  assert.equal(listWorldProfiles(storage).length, 1);

  const renamed = renameWorldProfile("world-a", "Fern Gully", storage);
  assert.equal(renamed?.name, "Fern Gully");
  assert.equal(getWorldProfile("world-a", storage)?.name, "Fern Gully");

  touchWorldProfile("world-a", storage, 2_000);
  assert.equal(getWorldProfile("world-a", storage)?.lastPlayedAt, 2_000);

  assert.equal(deleteWorldProfile("world-a", storage), true);
  assert.deepEqual(listWorldProfiles(storage), []);
});

test("worlds with the same seed keep independent edits", () => {
  const storage = new MemoryStorage();
  const first = createWorldProfile({ id: "first", name: "First", seed: 777, mode: "creative" });
  const second = createWorldProfile({ id: "second", name: "Second", seed: 777, mode: "survival" });
  saveWorldProfile(first, storage);
  saveWorldProfile(second, storage);

  const worldA = createWorld(777, 0, 0, 1);
  const editedA = setBlock(worldA, 2, 40, 2, "gold");
  assert.notEqual(editedA, worldA);
  saveWorldData(first.id, editedA, storage);

  const worldB = createWorld(777, 0, 0, 1);
  saveWorldData(second.id, worldB, storage);

  const reloadedA = loadWorldData(first.id, 777, 2, 2, 1, storage);
  const reloadedB = loadWorldData(second.id, 777, 2, 2, 1, storage);
  assert.equal(getBlock(reloadedA, 2, 40, 2), "gold");
  assert.equal(getBlock(reloadedB, 2, 40, 2), "stone", "the second world keeps its generated terrain");
  assert.notEqual(getBlock(reloadedB, 2, 40, 2), "gold", "one world's edit cannot leak into another");
});

test("duplicating a world copies its terrain history under a new identity", () => {
  const storage = new MemoryStorage();
  const original = createWorldProfile({ id: "original", name: "Original", seed: 900, mode: "creative" });
  saveWorldProfile(original, storage);

  const edited = setBlock(createWorld(900, 0, 0, 1), 3, 41, 3, "brick");
  saveWorldData(original.id, edited, storage);

  const copy = duplicateWorldProfile(original.id, storage, { name: "Original copy" });
  assert.ok(copy);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.seed, original.seed);

  const reloadedCopy = loadWorldData(copy.id, copy.seed, 3, 3, 1, storage);
  assert.equal(getBlock(reloadedCopy, 3, 41, 3), "brick");

  assert.equal(deleteWorldProfile(copy.id, storage), true);
  const reloadedOriginal = loadWorldData(original.id, original.seed, 3, 3, 1, storage);
  assert.equal(getBlock(reloadedOriginal, 3, 41, 3), "brick", "deleting the copy keeps the original");
});

test("duplicating a world copies every per-world save slot", () => {
  const storage = new MemoryStorage();
  const original = createWorldProfile({ id: "sidecar-source", name: "Source", seed: 55 });
  saveWorldProfile(original, storage);

  for (const slot of WORLD_SAVE_SLOTS) {
    storage.setItem(`${slot.prefix}${original.id}`, JSON.stringify({ slot: slot.id }));
  }

  const copy = duplicateWorldProfile(original.id, storage);
  assert.ok(copy);
  for (const slot of WORLD_SAVE_SLOTS) {
    assert.equal(
      storage.getItem(`${slot.prefix}${copy.id}`),
      storage.getItem(`${slot.prefix}${original.id}`),
      `${slot.label} should be copied`,
    );
  }
});

test("the seed-keyed save and global player are migrated once", () => {
  const storage = new MemoryStorage();
  const legacyWorld = setBlock(createWorld(1234, 0, 0, 1), 5, 42, 5, "glass");
  saveWorld(legacyWorld, storage);
  const legacyInventory = createInventory("creative");
  legacyInventory.gold = 9;
  savePlayer(null, legacyInventory, { x: 1, y: 50, z: 2 }, storage);
  assert.ok(storage.getItem(LEGACY_PLAYER_SAVE_KEY));

  const profiles = listWorldProfiles(storage);
  assert.equal(profiles.length, 1);
  const [profile] = profiles;
  assert.equal(profile.name, "My Wilderness");
  assert.equal(profile.seed, 1234);
  assert.equal(profile.legacySeed, 1234);

  const migrated = loadWorldData(profile.id, profile.seed, 5, 5, 1, storage);
  assert.equal(getBlock(migrated, 5, 42, 5), "glass");

  const player = readPlayerSave(profile.id, storage);
  assert.equal(player?.inventory.gold, 9);
  assert.deepEqual(player?.position, { x: 1, y: 50, z: 2 });

  // Listing again must not duplicate the migrated world.
  assert.equal(listWorldProfiles(storage).length, 1);
});

test("inventories start empty in survival and stocked in creative", () => {
  const survival = createInventory("survival");
  const creative = createInventory("creative");
  assert.equal(survival.grass, 0);
  assert.ok(creative.grass > 0);
});
