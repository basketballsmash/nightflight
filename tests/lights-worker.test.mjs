import test from "node:test";
import assert from "node:assert/strict";
import { createLightProcessor } from "../lights-worker.mjs";
import { visibilityFor } from "../light-geometry.mjs";

const center = [139.7, 35.6];
const view = {
  position: { lon: center[0], lat: center[1] },
  width: 1200,
  height: 800,
  tilt: 24,
  bearing: 0,
  roll: 0,
};
// An east-west primary road crossing the given latitude near the aircraft.
const road = (lat) => ({
  geometry: {
    type: "LineString",
    coordinates: [
      [center[0] - 0.05, lat],
      [center[0] + 0.05, lat],
    ],
  },
  properties: { class: "primary" },
});
const ahead = road(center[1] + 0.25),
  behind = road(center[1] - 0.08);
const message = (overrides = {}) => ({
  id: 1,
  epoch: 0,
  areas: [],
  roads: [ahead, behind],
  tiles: [],
  center,
  view,
  ...overrides,
});

test("the test roads sit in front of and behind the camera", () => {
  const visible = visibilityFor(view);
  assert.equal(visible([center[0], center[1] + 0.25]), true);
  assert.equal(visible([center[0], center[1] - 0.08]), false);
});

test("lights outside the view are generated so looking around shows them at once", () => {
  const result = createLightProcessor()(message());
  const lats = result.diff.add.map((f) => f.geometry.coordinates[1]);
  assert.ok(lats.some((lat) => lat > center[1]), "lights ahead");
  assert.ok(lats.some((lat) => lat < center[1]), "lights behind");
  assert.ok(result.visible > 0 && result.visible < result.count);
});

test("visible lights get the budget first, then the nearest hidden ones", () => {
  const full = createLightProcessor()(message()),
    budget = full.visible + 5,
    result = createLightProcessor()(message({ maxPoints: budget }));
  assert.equal(result.count, budget);
  const visible = visibilityFor(view),
    shown = result.diff.add.filter((f) => visible(f.geometry.coordinates));
  assert.equal(shown.length, full.visible, "every visible light is kept");
});

test("results are diffs against the previous result", () => {
  const process = createLightProcessor(),
    first = process(message());
  assert.ok(first.diff.add.length > 0);
  assert.deepEqual(first.diff.remove, []);

  const same = process(message({ id: 2 }));
  assert.deepEqual(same.diff, { add: [], remove: [] }, "nothing re-sent");

  const smaller = process(message({ id: 3, maxPoints: 10 }));
  assert.equal(smaller.diff.add.length, 0);
  assert.equal(smaller.diff.remove.length, first.count - 10);

  const restarted = process(message({ id: 4, epoch: 1 }));
  assert.equal(restarted.diff.add.length, first.count, "new flight starts over");
  assert.deepEqual(restarted.diff.remove, []);
  for (const feature of restarted.diff.add)
    assert.deepEqual(
      Object.keys(feature).filter((key) => key.startsWith("_")),
      [],
      "internal fields are stripped",
    );
});

test("minor roads fade out smoothly with distance, and leave once far away", async () => {
  const { fadeAt } = await import("../lights-worker.mjs");
  assert.equal(fadeAt("primary", 30000), 1, "major roads stay full nearby");
  assert.ok(fadeAt("primary", 120000) > 0.3, "and only thin gently far away");
  assert.equal(fadeAt("minor", 3000), 1);
  assert.ok(fadeAt("minor", 9000) > 0 && fadeAt("minor", 9000) < 1);
  assert.equal(fadeAt("minor", 20000), 0);

  const minor = (lat) => ({
    geometry: {
      type: "LineString",
      coordinates: [
        [center[0] - 0.03, lat],
        [center[0] + 0.03, lat],
      ],
    },
    properties: { class: "minor" },
  });
  const process = createLightProcessor(),
    near = minor(center[1] + 0.01), // ~1 km
    mid = minor(center[1] + 0.08), // ~9 km
    far = minor(center[1] + 0.2); // ~22 km
  const count = (road) =>
    createLightProcessor()(message({ roads: [road] })).count;
  assert.ok(count(near) > count(mid), "fewer lamps on mid-distance minor roads");
  assert.equal(count(far), 0, "none beyond the fade");

  const first = process(message({ roads: [near] }));
  assert.ok(first.count > 0);
  const moved = process(
    message({ id: 2, roads: [], center: [center[0], center[1] + 0.25] }),
  );
  assert.equal(moved.diff.remove.length, first.count, "far minor lamps are evicted");
});

test("an over-budget road network is thinned evenly, never cut off road by road", async () => {
  const { roadLights } = await import("../light-geometry.mjs");
  // Ten long parallel roads; a budget of half their lamps must leave lamps on
  // every road (the old early stop kept the first roads whole, dropped the rest).
  const roads = Array.from({ length: 10 }, (_, i) => ({
    geometry: {
      type: "LineString",
      coordinates: [
        [139.0, 35 + i * 0.05],
        [139.5, 35 + i * 0.05],
      ],
    },
    properties: { class: "primary" },
  }));
  const all = roadLights(roads, Infinity),
    half = roadLights(roads, Math.floor(all.length / 2));
  assert.equal(half.length, Math.floor(all.length / 2));
  const perRoad = new Map();
  for (const lamp of half) {
    const row = Math.round((lamp.geometry.coordinates[1] - 35) / 0.05);
    perRoad.set(row, (perRoad.get(row) || 0) + 1);
  }
  assert.equal(perRoad.size, 10, "every road keeps lamps");
  for (const n of perRoad.values()) assert.ok(n > all.length / 40, "roughly even");
});
