import assert from "node:assert/strict";
import test from "node:test";

import { createHierarchyPlan, validateHierarchyPlan } from "./settlement-hierarchy";

test("hierarchy counts and links are valid for representative seeds", () => {
  for (const seed of [0, 1, 42, 2025, 0xffffffff]) {
    const plan = createHierarchyPlan(seed);
    assert.deepEqual(validateHierarchyPlan(plan), [], `seed ${seed}`);

    const nodesAt = (level: string) => plan.nodes.filter((node) => node.level === level);
    const kingdoms = nodesAt("kingdom");
    const cities = nodesAt("city");
    const towns = nodesAt("town");
    const villages = nodesAt("village");
    const houses = nodesAt("house");
    const castles = nodesAt("castle");

    assert.equal(kingdoms.length, 1);
    assert.ok(cities.length >= 5 && cities.length <= 8);
    assert.equal(towns.length, cities.length * 5);
    assert.ok(villages.length >= towns.length * 5 && villages.length <= towns.length * 8);
    assert.ok(houses.length >= villages.length * 20 && houses.length <= villages.length * 30);
    assert.equal(castles.length, 1);
    assert.deepEqual(plan.castleWards[castles[0].id], ["outer", "inner", "keep"]);
  }
});

test("same seed and options produce byte-for-byte stable plans", () => {
  const first = createHierarchyPlan(8675309, { originX: -320, originZ: 640 });
  const second = createHierarchyPlan(8675309, { originX: -320, originZ: 640 });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("different origins translate all planned coordinates by the same offset", () => {
  const first = createHierarchyPlan(77, { originX: 0, originZ: 0 });
  const shifted = createHierarchyPlan(77, { originX: 1000, originZ: -250 });
  assert.equal(first.nodes.length, shifted.nodes.length);
  for (let i = 0; i < first.nodes.length; i += 1) {
    assert.equal(shifted.nodes[i].x, first.nodes[i].x + 1000);
    assert.equal(shifted.nodes[i].z, first.nodes[i].z - 250);
    assert.equal(shifted.nodes[i].id, first.nodes[i].id);
  }
});
