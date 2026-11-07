import test from "node:test";
import assert from "node:assert/strict";
import { packLights, createLightsLayer } from "../night-lights-layer.mjs";

const light = (id, kind, lon, lat) => ({
  type: "Feature",
  id,
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { kind, color: "#ff8000", radius: 0.8, opacity: 0.5 },
});

test("packs buildings before roads, relative to the centre, across the date line", () => {
  const center = [1, 0.5]; // mercator x = 1 is longitude 180
  const packed = packLights(
    [light("r", "road", -179.9, 0), light("b", "building", 179.9, 0)],
    center,
  );
  assert.equal(packed.buildings, 1);
  assert.equal(packed.roads, 1);
  const [bx, by, r, g, b, radius, opacity] = packed.data.slice(0, 7);
  assert.ok(bx < 0 && bx > -0.001, "179.9° sits just west of the centre");
  assert.ok(Math.abs(by) < 1e-6);
  assert.deepEqual([r, g, b].map((v) => Math.round(v * 255)), [255, 128, 0]);
  assert.ok(Math.abs(radius - 0.8) < 1e-6 && Math.abs(opacity - 0.5) < 1e-6);
  const rx = packed.data[8];
  assert.ok(rx > 0 && rx < 0.001, "-179.9° wraps to just east, not a world away");
});

test("the layer applies diffs and clears without a GPU", () => {
  const layer = createLightsLayer();
  assert.equal(layer.type, "custom");
  layer.applyDiff({ add: [light("a", "road", 0, 0), light("b", "building", 1, 1)] });
  assert.equal(layer.size, 2);
  layer.applyDiff({ add: [light("a", "road", 0.1, 0)], remove: ["b"] });
  assert.equal(layer.size, 1);
  layer.clear();
  assert.equal(layer.size, 0);
});

test("new lights fade in from their first appearance; updates keep their age", () => {
  let clock = 1000;
  const layer = createLightsLayer({ now: () => clock });
  clock = 1500;
  layer.applyDiff({ add: [light("a", "road", 0, 0)] });
  assert.equal(layer.bornAt("a"), 500);
  clock = 2500;
  layer.applyDiff({ add: [light("a", "road", 0.001, 0), light("b", "road", 1, 1)] });
  assert.equal(layer.bornAt("a"), 500, "an updated light does not fade in again");
  assert.equal(layer.bornAt("b"), 1500);
  const packed = packLights([light("a", "road", 0, 0)], [0.5, 0.5], new Map([["a", 500]]));
  assert.equal(packed.data[7], 500);
});
