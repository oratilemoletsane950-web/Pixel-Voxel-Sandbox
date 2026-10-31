import assert from "node:assert/strict";
import test from "node:test";

import { advanceMiningHold, beginMiningHold } from "./hold-mining";
import { miningDuration } from "./mining";

const grass = { x: 1, y: 4, z: 2, type: "grass" as const };

test("touch mining accumulates progress and cancels when the target changes", () => {
  const hold = beginMiningHold(grass, null);
  assert.ok(hold);
  const half = advanceMiningHold(hold, grass, 0.4, null);
  assert.ok(half.state);
  assert.ok(half.state.progress > 0 && half.state.progress < 1);

  const moved = advanceMiningHold(half.state, { ...grass, x: 2 }, 0.1, null);
  assert.equal(moved.state, null);
  assert.equal(moved.complete, false);
});

test("touch mining completes at the same duration as mouse mining", () => {
  let hold = beginMiningHold(grass, null);
  assert.ok(hold);
  const duration = miningDuration("grass", null);
  let result = { state: hold, complete: false };
  for (let elapsed = 0; elapsed < duration + 0.2; elapsed += 0.05) {
    result = advanceMiningHold(result.state ?? hold, grass, 0.05, null);
    if (result.complete) break;
  }
  assert.equal(result.complete, true);
  assert.equal(result.state, null);
});

test("unharvestable blocks never begin a touch hold", () => {
  assert.equal(beginMiningHold({ x: 0, y: 0, z: 0, type: "bedrock" }, null), null);
});
