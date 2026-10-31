import assert from "node:assert/strict";
import test from "node:test";

import {
  WEATHER_PERIOD,
  isColdBiome,
  weatherAt,
} from "./weather";

test("weather is stable inside an episode and changes across episodes", () => {
  const start = weatherAt(12345, 0, false);
  assert.deepEqual(weatherAt(12345, WEATHER_PERIOD - 1, false), start);
  const kinds = new Set<string>();
  for (let episode = 0; episode < 60; episode += 1) {
    kinds.add(weatherAt(12345, episode * WEATHER_PERIOD + 1, false).kind);
  }
  assert.ok(kinds.has("clear"));
  assert.ok(kinds.has("rain") || kinds.has("storm"));
});

test("cold biomes turn precipitation into snow", () => {
  assert.equal(isColdBiome("tundra"), true);
  assert.equal(isColdBiome("desert"), false);
  for (let season = 0; season < 80; season += 1) {
    const warm = weatherAt(77, season * WEATHER_PERIOD + 4, false);
    const cold = weatherAt(77, season * WEATHER_PERIOD + 4, true);
    if (warm.kind === "rain") assert.equal(cold.kind, "snow");
    else assert.equal(cold.kind, warm.kind);
  }
});

test("weather can produce every supported kind", () => {
  const kinds = new Set<string>();
  for (let seed = 0; seed < 100; seed += 1) {
    for (let episode = 0; episode < 20; episode += 1) {
      kinds.add(weatherAt(seed, episode * WEATHER_PERIOD + 1, false).kind);
      kinds.add(weatherAt(seed, episode * WEATHER_PERIOD + 1, true).kind);
    }
  }
  assert.deepEqual([...kinds].sort(), ["clear", "rain", "snow", "storm"]);
});

test("weather intensity stays in a renderable range", () => {
  for (let episode = 0; episode < 100; episode += 1) {
    const weather = weatherAt(9, episode * WEATHER_PERIOD + 1, false);
    assert.ok(weather.intensity > 0 && weather.intensity <= 1);
  }
});
