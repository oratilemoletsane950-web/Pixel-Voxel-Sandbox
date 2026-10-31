import assert from "node:assert/strict";
import test from "node:test";

import { advanceMining, miningDuration } from "./mining";

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
