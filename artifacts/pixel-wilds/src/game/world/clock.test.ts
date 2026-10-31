import assert from "node:assert/strict";
import test from "node:test";

import type { KeyValueStorage } from "../storage";
import {
  DAY_LENGTH_SECONDS,
  START_TIME,
  advanceWorldTime,
  dayPhase,
  daylight,
  formatWorldTime,
  normalizeWorldTime,
  readWorldClock,
  saveWorldClock,
  skyPalette,
} from "./clock";

class MemoryStorage implements KeyValueStorage {
  private readonly entries = new Map<string, string>();
  get length() { return this.entries.size; }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string) { this.entries.set(key, value); }
  removeItem(key: string) { this.entries.delete(key); }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
}

test("world time wraps in both directions and advances without drifting", () => {
  assert.equal(normalizeWorldTime(0), 0);
  assert.equal(normalizeWorldTime(DAY_LENGTH_SECONDS), 0);
  assert.equal(normalizeWorldTime(-1), DAY_LENGTH_SECONDS - 1);
  assert.equal(advanceWorldTime(DAY_LENGTH_SECONDS - 2, 3), 1);
  assert.equal(advanceWorldTime(START_TIME, -5), START_TIME);
});

test("daylight is dark at midnight, bright at noon and changes phase", () => {
  const midnight = DAY_LENGTH_SECONDS * 0;
  const dawn = DAY_LENGTH_SECONDS * 0.25;
  const noon = DAY_LENGTH_SECONDS * 0.5;
  const dusk = DAY_LENGTH_SECONDS * 0.75;

  assert.ok(daylight(midnight) < 0.1);
  assert.ok(daylight(noon) > 0.95);
  assert.ok(daylight(dawn) < daylight(noon));
  assert.ok(daylight(dusk) < daylight(noon));
  assert.equal(dayPhase(midnight), "night");
  assert.equal(dayPhase(dawn), "dawn");
  assert.equal(dayPhase(noon), "day");
  assert.equal(dayPhase(dusk), "dusk");
});

test("the clock formats as a 24-hour time", () => {
  assert.equal(formatWorldTime(0), "00:00");
  assert.equal(formatWorldTime(START_TIME), "08:00");
  assert.equal(formatWorldTime(DAY_LENGTH_SECONDS / 2), "12:00");
});

test("sky palettes differ between night and noon", () => {
  const night = skyPalette(0);
  const noon = skyPalette(DAY_LENGTH_SECONDS / 2);
  assert.notEqual(night.sky, noon.sky);
  assert.ok(noon.light > night.light);
  assert.ok(noon.ambient.startsWith("#"));
});

test("world clocks round-trip through injected storage", () => {
  const storage = new MemoryStorage();
  assert.equal(saveWorldClock("world-a", 123, storage), true);
  assert.equal(readWorldClock("world-a", storage), 123);

  storage.setItem("pixel-wilds-clock-v1:bad", "{not json");
  assert.equal(readWorldClock("bad", storage), null);
});
