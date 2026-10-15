import assert from "node:assert/strict";
import test from "node:test";

import { clearHierarchyPlanCache, hierarchyNodesInBounds, hierarchyPlanFor } from "./hierarchy-streaming";

test("plan cache reuses identical seed and origin", () => {
  clearHierarchyPlanCache();
  const first = hierarchyPlanFor(123, { originX: 12, originZ: 34 });
  const second = hierarchyPlanFor(123, { originX: 12, originZ: 34 });
  assert.equal(first, second);
});

test("bounds query returns only intersecting node centres in stable order", () => {
  const plan = hierarchyPlanFor(42);
  const expected = plan.nodes
    .filter((node) => node.x >= -100 && node.x <= 100 && node.z >= -100 && node.z <= 100)
    .sort((a, b) => a.x - b.x || a.z - b.z || a.id.localeCompare(b.id));
  assert.deepEqual(hierarchyNodesInBounds(plan, -100, -100, 100, 100), expected);
});

test("bounds query margin includes nearby node centres and negative coordinates work", () => {
  const plan = hierarchyPlanFor(42, { originX: -900, originZ: -900 });
  const target = plan.nodes.find((node) => node.level === "kingdom");
  assert.ok(target);
  const result = hierarchyNodesInBounds(plan, target.x + 10, target.z + 10, target.x + 20, target.z + 20, 20);
  assert.ok(result.some((node) => node.id === target.id));
});

test("bounds query rejects invalid bounds and margins", () => {
  const plan = hierarchyPlanFor(9);
  assert.throws(() => hierarchyNodesInBounds(plan, 10, 0, -10, 5), RangeError);
  assert.throws(() => hierarchyNodesInBounds(plan, 0, 0, 1, 1, -1), RangeError);
  assert.throws(() => hierarchyNodesInBounds(plan, Number.NaN, 0, 1, 1), RangeError);
});
