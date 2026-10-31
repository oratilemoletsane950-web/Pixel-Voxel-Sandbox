import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_WAYPOINTS,
  addWaypoint,
  readWaypoints,
  removeWaypoint,
  renameWaypoint,
  saveWaypoints,
  sortWaypoints,
} from "./waypoints";
import type { KeyValueStorage } from "../storage";

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
  };
}

test("waypoints add, rename, remove and persist", () => {
  const storage = memoryStorage();
  let list = addWaypoint([], { x: 1.24, y: 8, z: -3.46 }, "  Home   camp ");
  assert.equal(list[0].label, "Home camp");
  assert.equal(list[0].x, 1.2);
  list = addWaypoint(list, { x: 30, y: 8, z: 40 }, "", 1000);
  list = renameWaypoint(list, list[1].id, "North ridge");
  assert.equal(list[1].label, "North ridge");
  assert.deepEqual(sortWaypoints(list, { x: 0, y: 0, z: 0 }).map((entry) => entry.label), [
    "Home camp",
    "North ridge",
  ]);
  assert.ok(saveWaypoints("world", list, storage));
  assert.deepEqual(readWaypoints("world", storage), list);
  assert.equal(removeWaypoint(list, list[0].id).length, 1);
});

test("waypoint reads reject malformed rows and cap the list", () => {
  const storage = memoryStorage();
  storage.setItem(
    "pixel-wilds-waypoints-v1:world",
    JSON.stringify({
      version: 1,
      waypoints: [
        { id: "a", label: "A", color: "#fff", x: 1, y: 2, z: 3, createdAt: 1 },
        { id: "a", label: "duplicate", color: "#fff", x: 1, y: 2, z: 3, createdAt: 1 },
        { id: "bad", label: "Bad", color: "#fff", x: "nope", y: 2, z: 3, createdAt: 1 },
      ],
    }),
  );
  assert.equal(readWaypoints("world", storage).length, 1);
  let list = [];
  for (let index = 0; index < MAX_WAYPOINTS + 4; index += 1) {
    list = addWaypoint(list, { x: index, y: 1, z: 1 }, `W${index}`, index);
  }
  assert.equal(list.length, MAX_WAYPOINTS);
});
