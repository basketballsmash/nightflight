import test from "node:test";
import assert from "node:assert/strict";
import { insidePolygon, createPlaceLights } from "../place-lights.mjs";
const outer = [
  [139, 35],
  [139.04, 35],
  [139.04, 35.04],
  [139, 35.04],
  [139, 35],
];
const hole = [
  [139.015, 35.015],
  [139.025, 35.015],
  [139.025, 35.025],
  [139.015, 35.025],
  [139.015, 35.015],
];
const area = {
  type: "Feature",
  properties: { class: "residential" },
  geometry: { type: "Polygon", coordinates: [outer, hole] },
};
const options = { center: [139.02, 35.02], maxPoints: 200 };
test("neighborhood light points stay within mapped polygons and out of holes", () => {
  const result = createPlaceLights([area], options);
  assert.ok(result.features.length > 20);
  for (const feature of result.features)
    assert.ok(insidePolygon(feature.geometry.coordinates, [outer, hole]));
});
test("light generation is stable, capped, and deduplicates source tile overlaps", () => {
  const a = createPlaceLights([area], options),
    b = createPlaceLights([area], options),
    duplicates = createPlaceLights([area, area], options);
  assert.deepEqual(a, b);
  assert.deepEqual(a, duplicates);
  assert.ok(a.features.length <= 200);
  assert.equal(
    createPlaceLights([area], { ...options, maxPoints: 10 }).features.length,
    10,
  );
});
test("building lights vary in color, radius, and brightness without animation", () => {
  const features = createPlaceLights([area], options).features;
  assert.ok(new Set(features.map((f) => f.properties.color)).size >= 4);
  assert.ok(new Set(features.map((f) => f.properties.radius)).size > 20);
  assert.ok(new Set(features.map((f) => f.properties.opacity)).size > 20);
  for (const { properties: p } of features) {
    assert.ok(p.radius > 0 && p.radius < 2);
    assert.ok(p.opacity >= 0 && p.opacity <= 1);
  }
});
test("empty, non-polygon, and faraway data produce no local light points", () => {
  assert.equal(createPlaceLights([]).features.length, 0);
  assert.equal(
    createPlaceLights(
      [{ geometry: { type: "Point", coordinates: [139, 35] } }],
      options,
    ).features.length,
    0,
  );
  assert.equal(
    createPlaceLights([area], { center: [-74, 40] }).features.length,
    0,
  );
});
test("tile clipping never changes which lights exist (no tile-shaped density edges)", () => {
  // The same neighbourhood, whole and cut into the four pieces vector tiles
  // would deliver, must light up identically: density depends on distance only.
  const square = (x0, y0, x1, y1) => ({
    properties: { class: "residential" },
    geometry: {
      type: "Polygon",
      coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
    },
  });
  for (const center of [[139.02, 35.02], [139.3, 35.02]]) {
    const ids = (areas) =>
      createPlaceLights(areas, { center, maxPoints: 1e6 })
        .features.map((f) => f.id)
        .sort();
    const whole = ids([square(139, 35, 139.08, 35.08)]),
      pieces = ids([
        square(139, 35, 139.04, 35.04),
        square(139.04, 35, 139.08, 35.04),
        square(139, 35.04, 139.04, 35.08),
        square(139.04, 35.04, 139.08, 35.08),
      ]);
    assert.ok(whole.length > 20);
    assert.deepEqual(pieces, whole);
  }
});
