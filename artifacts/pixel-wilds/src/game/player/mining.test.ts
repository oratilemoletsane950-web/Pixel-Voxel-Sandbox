import assert from "node:assert/strict";
import test from "node:test";

import { advanceMining, canHarvest, miningDuration } from "./mining";

test("harder blocks take longer to mine", () => {
  assert.ok(miningDuration("stone") > miningDuration("leaves"));
  assert.ok(miningDuration("iron_ore") > miningDuration("planks"));
  assert.equal(miningDuration("bedrock"), Infinity);
});

test("mining progresses and completes at the block hardness", () => {
  const duration = miningDuration("stone");
  const halfway = advanceMining(0, duration / 2, "stone");
  assert.ok(halfway.progress > 0.49 && halfway.progress < 0.51);
  assert.equal(halfway.complete, false);

  const done = advanceMining(halfway.progress, duration, "stone");
  assert.equal(done.progress, 1);
  assert.equal(done.complete, true);
});

test("unbreakable blocks never complete", () => {
  const result = advanceMining(0, 10, "bedrock");
  assert.deepEqual(result, { progress: 0, complete: false });
});

test("a matching tool speeds mining and a mismatched tool does not", () => {
  const pickaxe = { kind: "pickaxe" as const, tier: 2, speed: 3.6 };
  const axe = { kind: "axe" as const, tier: 3, speed: 5.4 };
  assert.ok(miningDuration("stone", pickaxe) < miningDuration("stone"));
  assert.equal(miningDuration("stone", axe), miningDuration("stone"));
  assert.ok(miningDuration("wood", axe) < miningDuration("wood"));
  assert.ok(miningDuration("dirt", { kind: "shovel", tier: 1, speed: 2.2 }) < miningDuration("dirt"));
});

test("ore tiers gate bare hands, weak tools and wrong tools", () => {
  const woodenPick = { kind: "pickaxe" as const, tier: 1, speed: 2.2 };
  const stonePick = { kind: "pickaxe" as const, tier: 2, speed: 3.6 };
  assert.equal(canHarvest("coal_ore", woodenPick), true);
  assert.equal(canHarvest("coal_ore", null), false);
  assert.equal(canHarvest("iron_ore", woodenPick), false);
  assert.equal(canHarvest("iron_ore", stonePick), true);
  assert.equal(canHarvest("iron_ore", { kind: "axe", tier: 3, speed: 5.4 }), false);
  assert.equal(miningDuration("iron_ore", woodenPick), Infinity);
  assert.ok(Number.isFinite(miningDuration("iron_ore", stonePick)));
});
