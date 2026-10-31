import assert from "node:assert/strict";
import test from "node:test";

import type { KeyValueStorage } from "../storage";
import {
  MAX_AIR,
  MAX_HEALTH,
  addBerries,
  applyDamage,
  canEat,
  createSurvivalState,
  deleteSurvivalSave,
  eatBerries,
  fallDamage,
  readSurvivalSave,
  respawnSurvival,
  saveSurvival,
  tickSurvival,
  type SurvivalEnvironment,
} from "./survival";

class MemoryStorage implements KeyValueStorage {
  private readonly entries = new Map<string, string>();
  get length() { return this.entries.size; }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string) { this.entries.set(key, value); }
  removeItem(key: string) { this.entries.delete(key); }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
}

const STILL: SurvivalEnvironment = {
  underwater: false,
  inWater: false,
  moving: false,
  sprinting: false,
};

test("fall damage scales with impact and difficulty", () => {
  assert.equal(fallDamage(7.9, "normal"), 0, "a normal jump must stay safe");
  assert.equal(fallDamage(8.01, "normal"), 1);
  assert.ok(fallDamage(18, "hard") > fallDamage(18, "normal"));
  assert.ok(fallDamage(18, "peaceful") < fallDamage(18, "normal"));
});

test("hunger drains only in survival and faster while active", () => {
  const full = createSurvivalState();
  const idle = tickSurvival(full, STILL, "normal", 1);
  const moving = tickSurvival(full, { ...STILL, moving: true }, "normal", 1);
  const sprinting = tickSurvival(full, { ...STILL, moving: true, sprinting: true }, "normal", 1);
  const peaceful = tickSurvival(full, STILL, "peaceful", 1);

  assert.ok(idle.hunger < full.hunger);
  assert.ok(moving.hunger < idle.hunger);
  assert.ok(sprinting.hunger < moving.hunger);
  assert.equal(peaceful.hunger, full.hunger);
});

test("starvation hurts on schedule and peaceful never starves", () => {
  let starving = { ...createSurvivalState(), hunger: 0 };
  for (let second = 0; second < 4; second += 1) {
    starving = tickSurvival(starving, STILL, "normal", 1);
  }
  assert.equal(starving.health, MAX_HEALTH - 1);

  let peaceful = { ...createSurvivalState(), hunger: 0 };
  for (let second = 0; second < 12; second += 1) {
    peaceful = tickSurvival(peaceful, STILL, "peaceful", 1);
  }
  assert.equal(peaceful.health, MAX_HEALTH);
});

test("breath drains underwater, refills on the surface and drowning damages", () => {
  let state = { ...createSurvivalState(), air: 0.5 };
  state = tickSurvival(state, { ...STILL, underwater: true, inWater: true }, "normal", 0.6);
  assert.equal(state.air, 0);
  state = tickSurvival(state, { ...STILL, underwater: true, inWater: true }, "normal", 0.6);
  state = tickSurvival(state, { ...STILL, underwater: true, inWater: true }, "normal", 0.6);
  assert.equal(state.health, MAX_HEALTH - 2);

  let surfaced = tickSurvival(state, { ...STILL, inWater: true }, "normal", 1);
  assert.equal(surfaced.air, 4);
  for (let second = 0; second < 4; second += 1) {
    surfaced = tickSurvival(surfaced, { ...STILL, inWater: true }, "normal", 1);
  }
  assert.equal(surfaced.air, MAX_AIR);
});

test("berries are foraged, eaten and kept through respawn", () => {
  const hungry = addBerries({ ...createSurvivalState(), hunger: 10 }, 2);
  assert.equal(hungry.berries, 2);
  assert.equal(canEat(hungry), true);

  const fed = eatBerries(hungry);
  assert.equal(fed.berries, 1);
  assert.equal(fed.hunger, 16);

  const full = { ...hungry, hunger: 20 };
  assert.equal(canEat(full), false);
  assert.equal(eatBerries(full), full);

  const dead = applyDamage({ ...hungry, health: 2 }, 2, "fall");
  assert.equal(dead.alive, false);
  assert.equal(dead.cause, "fall");

  const respawned = respawnSurvival(dead);
  assert.equal(respawned.alive, true);
  assert.equal(respawned.health, MAX_HEALTH);
  assert.equal(respawned.berries, 2);
});

test("a fatal hazard records its cause", () => {
  const drowned = applyDamage({ ...createSurvivalState(), health: 3 }, 3, "drowning");
  assert.equal(drowned.alive, false);
  assert.equal(drowned.cause, "drowning");
  assert.equal(applyDamage(drowned, 5, "void"), drowned, "a dead player ignores further damage");
});

test("survival saves round-trip and reject dead or malformed data", () => {
  const storage = new MemoryStorage();
  const state = { ...createSurvivalState(), health: 12.4, hunger: 3.7, berries: 4 };
  assert.equal(saveSurvival("world-a", state, storage), true);

  const restored = readSurvivalSave("world-a", storage);
  assert.equal(restored?.health, 12);
  assert.equal(restored?.hunger, 3.7);
  assert.equal(restored?.berries, 4);

  storage.setItem("pixel-wilds-survival-v1:dead", JSON.stringify({ health: 0, hunger: 2, berries: 1 }));
  assert.equal(readSurvivalSave("dead", storage), null);

  storage.setItem("pixel-wilds-survival-v1:broken", "{not json");
  assert.equal(readSurvivalSave("broken", storage), null);

  deleteSurvivalSave("world-a", storage);
  assert.equal(readSurvivalSave("world-a", storage), null);
});
