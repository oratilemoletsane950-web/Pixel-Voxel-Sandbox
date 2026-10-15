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
    assert.ok(["hilltop", "concentric", "riverside", "palace-fortress"].includes(String(castles[0].metadata.archetype)));
    assert.ok(Number(castles[0].metadata.strategicRadius) >= 64);
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
    assert.equal(shifted.nodes[i].z + 250, first.nodes[i].z);
    assert.equal(shifted.nodes[i].id, first.nodes[i].id);
  }
});

test("city, town, and village centres retain minimum separation", () => {
  for (const seed of [3, 19, 42, 101, 2026]) {
    const plan = createHierarchyPlan(seed);
    const byId = new Map(plan.nodes.map((node) => [node.id, node]));
    const cities = plan.nodes.filter((node) => node.level === "city");
    for (let i = 0; i < cities.length; i += 1) {
      for (let j = i + 1; j < cities.length; j += 1) {
        const distance = Math.hypot(cities[i].x - cities[j].x, cities[i].z - cities[j].z);
        assert.ok(distance > 1450, `cities too close for seed ${seed}: ${distance}`);
      }
      const towns = cities[i].children.map((id) => byId.get(id)).filter((node) => node?.level === "town");
      for (let a = 0; a < towns.length; a += 1) {
        for (let b = a + 1; b < towns.length; b += 1) {
          const distance = Math.hypot(towns[a]!.x - towns[b]!.x, towns[a]!.z - towns[b]!.z);
          assert.ok(distance > 400, `towns too close for seed ${seed}: ${distance}`);
        }
        const villages = towns[a]!.children.map((id) => byId.get(id)).filter((node) => node?.level === "village");
        for (let v = 0; v < villages.length; v += 1) {
          for (let w = v + 1; w < villages.length; w += 1) {
            const distance = Math.hypot(villages[v]!.x - villages[w]!.x, villages[v]!.z - villages[w]!.z);
            assert.ok(distance > 80, `villages too close for seed ${seed}: ${distance}`);
          }
        }
      }
    }
  }
});

test("castle archetypes vary by seed and remain deterministic", () => {
  const archetypes = new Set<string>();
  for (const seed of [0, 1, 2, 3, 4, 5, 42, 2026, 9999]) {
    const first = createHierarchyPlan(seed);
    const second = createHierarchyPlan(seed);
    const castle = first.nodes.find((node) => node.level === "castle");
    const repeated = second.nodes.find((node) => node.level === "castle");
    assert.ok(castle);
    assert.equal(castle.metadata.archetype, repeated?.metadata.archetype);
    assert.equal(castle.x, repeated?.x);
    assert.equal(castle.z, repeated?.z);
    archetypes.add(String(castle.metadata.archetype));
  }
  assert.ok(archetypes.size >= 3, `expected varied castle designs, got ${[...archetypes].join(", ")}`);
});
