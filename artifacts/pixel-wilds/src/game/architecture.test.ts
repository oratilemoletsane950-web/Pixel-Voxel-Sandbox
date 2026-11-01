import assert from "node:assert/strict";
import test from "node:test";

import {
  BLOCK_DEFINITIONS,
  BLOCK_ID,
  BLOCK_INFO,
  BLOCK_TYPES,
  IS_OPAQUE,
  IS_SOLID,
  WORLD_BLOCK_TYPES,
  buildBlockTables,
  type BlockDefinition,
} from "./blocks";
import { Pipeline } from "./core/pipeline";
import { prototype } from "./core/prototype";
import { Registry } from "./core/registry";
import { SURFACE_CLASSIFIER, SurfaceClassifier, type SurfaceRule } from "./terrain";
import { SPECIES } from "./vegetation/species";
import { chunkStageOrder } from "./worldgen";
import {
  deleteSavedWorld,
  getBlock,
  listSavedWorldSeeds,
  loadWorld,
  createWorld,
  saveWorld,
  setBlock,
  type KeyValueStorage,
} from "./world";

/**
 * Contract tests for the module architecture: the registries, the prototype
 * pattern, the ordered pipeline and the injectable storage seam. These are the
 * pieces future features are plugged into, so they are tested directly rather
 * than only through world output.
 */

class MemoryStorage implements KeyValueStorage {
  private readonly entries = new Map<string, string>();
  get length(): number {
    return this.entries.size;
  }
  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
  removeItem(key: string): void {
    this.entries.delete(key);
  }
  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }
}

test("registry keeps registration order and rejects duplicate ids", () => {
  const registry = new Registry<{ id: string; value?: number }>("test");
  assert.equal(registry.register({ id: "b", value: 1 }).value, 1, "register returns the entry");
  registry.register({ id: "a" });
  assert.deepEqual(registry.ids(), ["b", "a"]);
  assert.equal(registry.get("a")?.id, "a");
  assert.throws(() => registry.register({ id: "a" }), /duplicate id "a"/);
  assert.throws(() => registry.require("missing"), /unknown id "missing"/);
  assert.equal(registry.size, 2);
});

test("registry assertExact fails on missing, extra and reordered entries", () => {
  const registry = new Registry<{ id: string }>("test").registerAll([{ id: "a" }, { id: "b" }]);
  assert.doesNotThrow(() => registry.assertExact(["a", "b"]));
  assert.throws(() => registry.assertExact(["a"]), /entries without a declared slot/);
  assert.throws(() => registry.assertExact(["a", "b", "c"]), /missing entries c/);
  assert.throws(() => registry.assertExact(["b", "a"]), /order must match/);
});

test("prototype clones without mutating the prototype it derives from", () => {
  const base = prototype({ solid: true, alpha: 1, pattern: "speckle" });
  const glass = base.extend({ alpha: 0.42, pattern: "glass" });
  assert.equal(base.alpha, 1);
  assert.equal(base.pattern, "speckle");
  assert.equal(glass.alpha, 0.42);
  assert.equal(glass.pattern, "glass");
  assert.equal(glass.solid, true, "clone inherits unspecified traits");
  assert.equal(glass.prototypeOf, "base");
});

test("pipeline runs in order, skips disabled stages and rejects duplicates", () => {
  const ran: string[] = [];
  const pipeline = new Pipeline<null>("test")
    .register({ id: "last", order: 30, run: () => ran.push("last") })
    .register({ id: "first", order: 10, run: () => ran.push("first") })
    .register({ id: "off", order: 20, enabled: false, run: () => ran.push("off") })
    .register({ id: "middle", order: 20, run: () => ran.push("middle") });
  assert.deepEqual(pipeline.list().map((stage) => stage.id), ["first", "off", "middle", "last"]);
  assert.deepEqual(pipeline.run(null), ["first", "middle", "last"]);
  assert.deepEqual(ran, ["first", "middle", "last"]);
  assert.throws(() => pipeline.register({ id: "first", order: 1, run: () => {} }), /duplicate stage/);
});

test("food and crop stages are never placeable construction blocks", () => {
  assert.equal(BLOCK_INFO.bread.placeable, false);
  assert.equal(BLOCK_INFO.wheat_grain.placeable, false);
  assert.equal(BLOCK_INFO.wheat_sprout.placeable, false);
  assert.equal(BLOCK_INFO.wheat_ripe.placeable, false);
  assert.equal(BLOCK_INFO.wheat_seeds.placeable, true);
  assert.equal(BLOCK_INFO.stone.placeable, true);
});

test("block ids, catalogue and lookup tables agree", () => {
  assert.equal(WORLD_BLOCK_TYPES.length, BLOCK_DEFINITIONS.length);
  WORLD_BLOCK_TYPES.forEach((name, index) => {
    assert.equal(BLOCK_ID[name], index + 1, `${name} id must follow declared order`);
    assert.equal(BLOCK_INFO[name].name, name);
  });
  assert.equal(IS_SOLID.length, WORLD_BLOCK_TYPES.length + 1);
  assert.equal(IS_OPAQUE.length, WORLD_BLOCK_TYPES.length + 1);
  for (const name of BLOCK_TYPES) {
    assert.equal(BLOCK_INFO[name].collectible, true, `${name} should be collectible`);
    assert.ok(BLOCK_INFO[name].hardness > 0, `${name} needs a positive mining hardness`);
  }
  for (const name of WORLD_BLOCK_TYPES.filter((entry) => !(BLOCK_TYPES as readonly string[]).includes(entry))) {
    assert.equal(BLOCK_INFO[name].collectible, false, `${name} is scenery and must not be collectible`);
  }
});

test("block catalogue validation rejects gaps, duplicates and unknown names", () => {
  const [first] = BLOCK_DEFINITIONS;
  assert.throws(
    () => buildBlockTables([], [first.name], BLOCK_TYPES),
    /no definition for/,
  );
  assert.throws(
    () => buildBlockTables([first, first], [first.name], BLOCK_TYPES),
    /duplicate entry/,
  );
  const stranger = { ...first, name: "mystery" } as BlockDefinition;
  assert.throws(
    () => buildBlockTables([first, stranger], [first.name], BLOCK_TYPES),
    /no id slot/,
  );
});

test("chunk generation stages are registered in the historical order", () => {
  assert.deepEqual(chunkStageOrder(), ["geology", "ores", "caves", "ground-cover", "vegetation", "settlements"]);
});

test("every vegetation species declares a habitat and a stamp", () => {
  assert.ok(SPECIES.size >= 10);
  for (const species of SPECIES.list()) {
    assert.ok(species.habitats.length > 0, `${species.id} has no habitat`);
    assert.equal(typeof species.stamp, "function");
    for (const habitat of species.habitats) {
      assert.ok(habitat.biomes.length > 0, `${species.id} habitat has no biomes`);
      assert.ok(Number.isFinite(habitat.priority), `${species.id} habitat needs a priority`);
    }
  }
});

test("surface classifier sorts rules by precedence and rejects duplicates", () => {
  const rule = (id: string, order: number): SurfaceRule => ({
    id,
    order,
    apply: () => false,
  });
  const classifier = new SurfaceClassifier([rule("late", 50), rule("early", 10)]);
  assert.deepEqual(classifier.list().map((entry) => entry.id), ["early", "late"]);
  assert.throws(() => new SurfaceClassifier([rule("same", 1), rule("same", 2)]), /Duplicate surface rule/);
  assert.deepEqual(
    SURFACE_CLASSIFIER.list().map((entry) => entry.id),
    [
      "underwater",
      "shore",
      "steep-rock",
      "slope-shelf",
      "volcanic",
      "frozen",
      "cold",
      "arid",
      "wetland",
      "eroded-badlands",
      "fungal",
      "rainforest",
      "forest",
      "savanna",
      "open-ground",
    ],
  );
});

test("worlds save and load through an injected storage backend", () => {
  const storage = new MemoryStorage();
  const world = createWorld(8675309, 0, 0, 1);
  const edited = setBlock(world, 2, 40, 2, "gold");
  assert.notEqual(edited, world, "editing a block returns a new world");
  saveWorld(edited, storage);
  assert.ok(listSavedWorldSeeds(storage).includes(8675309));

  const loaded = loadWorld(2, 2, 1, 8675309, storage);
  assert.equal(loaded.seed, 8675309);
  assert.equal(getBlock(loaded, 2, 40, 2), "gold", "saved edits survive a reload");

  deleteSavedWorld(8675309, storage);
  assert.equal(listSavedWorldSeeds(storage).includes(8675309), false);
});
