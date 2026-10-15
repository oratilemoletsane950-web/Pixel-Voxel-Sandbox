import assert from "node:assert/strict";
import test from "node:test";

import { blueprintById } from "./blueprints";
import { SEA_LEVEL } from "./chunk";
import { resolveHierarchyPlan } from "./settlements";
import { createHierarchyPlan } from "./settlement-hierarchy";
import { Terrain } from "./terrain";

test("resolved hierarchy sites are terrain-safe and globally footprint-reserved", () => {
  const seed = 42;
  const source = createHierarchyPlan(seed);
  const resolved = resolveHierarchyPlan(source, new Terrain(seed));
  const placed = resolved.nodes.filter((node) => node.metadata.placementValid === true);
  assert.ok(placed.some((node) => node.level === "city"));
  assert.ok(placed.some((node) => node.level === "town"));
  assert.ok(placed.some((node) => node.level === "village"));
  assert.ok(placed.some((node) => node.level === "castle"));

  for (const node of placed) {
    const ground = Number(node.metadata.resolvedGround);
    assert.ok(Number.isFinite(ground), node.id + " has no resolved ground");
    assert.ok(ground > SEA_LEVEL + 2, node.id + " is too close to sea level");
    assert.ok(ground < 192, node.id + " exceeds world height");
  }

  const major = placed.filter((node) => ["city", "town", "village", "castle"].includes(node.level));
  const half = (node: typeof major[number]) =>
    node.level === "city" ? 20 : node.level === "town" ? 55 : node.level === "village" ? 10 : 66;
  for (let i = 0; i < major.length; i += 1) {
    for (let j = i + 1; j < major.length; j += 1) {
      const a = major[i]!;
      const b = major[j]!;
      assert.ok(
        Math.abs(a.x - b.x) >= half(a) + half(b) + 8 ||
        Math.abs(a.z - b.z) >= half(a) + half(b) + 8,
        "major footprints conflict: " + a.id + " and " + b.id,
      );
    }
  }

  const houses = placed.filter((node) => node.level === "house");
  assert.ok(houses.length > 0);
  const blueprintIds = ["simple_home", "farmers_cottage", "fishermans_hut", "woodcutters_cabin", "bakers_house"] as const;
  const byId = new Map(resolved.nodes.map((node) => [node.id, node]));
  const dimensions = (node: typeof houses[number]) => {
    const index = Math.max(0, Math.min(4, Math.floor(Number(node.metadata.archetypeIndex) || 0)));
    const bp = blueprintById("village", blueprintIds[index]);
    return { halfW: Math.ceil(bp.w / 2), halfD: Math.ceil(bp.d / 2) };
  };
  for (let i = 0; i < houses.length; i += 1) {
    const a = houses[i]!;
    const ad = dimensions(a);
    for (let j = i + 1; j < houses.length; j += 1) {
      const b = houses[j]!;
      const bd = dimensions(b);
      assert.ok(
        Math.abs(a.x - b.x) >= ad.halfW + bd.halfW + 3 ||
        Math.abs(a.z - b.z) >= ad.halfD + bd.halfD + 3,
        "house footprints conflict: " + a.id + " and " + b.id,
      );
    }
    for (const structure of major) {
      if (structure.id === a.parentId) continue;
      const size = half(structure);
      assert.ok(
        Math.abs(a.x - structure.x) >= ad.halfW + size + 4 ||
        Math.abs(a.z - structure.z) >= ad.halfD + size + 4,
        "house overlaps major structure: " + a.id + " and " + structure.id,
      );
    }
    const parent = byId.get(a.parentId ?? "");
    assert.ok(parent && parent.metadata.placementValid === true, "house has an unresolved village parent");
  }
});
