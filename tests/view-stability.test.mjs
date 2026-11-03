import test from "node:test";
import assert from "node:assert/strict";
import { flightCamera, meteorPath, skyClipPolygon } from "../view-math.mjs";
import { roadLights } from "../light-geometry.mjs";
const rad = Math.PI / 180,
  world = 2 * Math.PI * 6371008.8;
function recoverCamera(options, height) {
  const [lon, lat] = options.center,
    scale = 1 / (world * Math.cos(lat * rad)),
    d = height / (2 * Math.tan(30 * rad)) / (512 * 2 ** options.zoom),
    pitch = options.pitch * rad,
    bearing = options.bearing * rad;
  const x = (lon + 180) / 360 - Math.sin(bearing) * Math.sin(pitch) * d,
    y =
      (1 - Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2)) / Math.PI) / 2 +
      Math.cos(bearing) * Math.sin(pitch) * d,
    z = options.elevation * scale + Math.cos(pitch) * d;
  const cameraLat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / rad;
  return {
    lon: x * 360 - 180,
    lat: cameraLat,
    altitude: z * world * Math.cos(cameraLat * rad),
  };
}
test("camera position and altitude survive repeated extreme view changes", () => {
  for (const position of [
    { lat: 35.68, lon: 139.76 },
    { lat: 51.5, lon: -0.12 },
    { lat: -33.86, lon: 151.2 },
    { lat: 0, lon: 179.99 },
  ])
    for (let n = 0; n < 80; n++) {
      const options = flightCamera({
        position,
        heading: 90,
        yaw: [-179, 179, 90, -90, 0][n % 5],
        tilt: [-32, 0, 78, 24][n % 4],
        height: 844,
      });
      assert.ok(Object.values(options).flat().every(Number.isFinite));
      const result = recoverCamera(options, 844);
      assert.ok(Math.abs(result.lat - position.lat) < 1e-8);
      assert.ok(Math.abs(result.lon - position.lon) < 1e-8);
      assert.ok(Math.abs(result.altitude - 9000) < 1e-5);
    }
});
test("view limits prevent flipping past the sky or directly below the camera", () => {
  assert.equal(
    flightCamera({ position: { lat: 0, lon: 0 }, tilt: -500 }).pitch,
    122,
  );
  assert.equal(
    flightCamera({ position: { lat: 0, lon: 0 }, tilt: 500 }).pitch,
    12,
  );
});
test("meteor heads and tails always remain above the horizon", () => {
  for (const elevation of [0.15, 0.2, 0.5, 1.2])
    for (let t = 0; t <= 1.1; t += 0.01) {
      const p = meteorPath({ az: 0, elevation, va: 0.35 }, t),
        tail = meteorPath(
          { az: 0, elevation, va: 0.35 },
          Math.max(0, t - 0.14),
        );
      assert.ok(p.elevation >= 0.0899);
      assert.ok(tail.elevation >= p.elevation);
    }
});
test("sky clipping excludes the ground and handles fully upward/downward views", () => {
  const sky = skyClipPolygon(1200, 800, 24, 0);
  assert.ok(sky.length >= 3);
  assert.ok(Math.max(...sky.map((p) => p[1])) < 400);
  assert.equal(skyClipPolygon(1200, 800, 78, 0).length, 0);
  assert.ok(skyClipPolygon(1200, 800, -32, 0).some((p) => p[1] >= 800));
});
test("road lamp positions survive vector-tile clipping and stay bounded", () => {
  const feature = (coordinates) => ({
    properties: { class: "primary" },
    geometry: { type: "LineString", coordinates },
  });
  const whole = roadLights([
    feature([
      [139, 35],
      [139.04, 35],
    ]),
  ]);
  const clipped = roadLights([
    feature([
      [139, 35],
      [139.02, 35],
    ]),
    feature([
      [139.02, 35],
      [139.04, 35],
    ]),
  ]);
  assert.ok(whole.length > 10);
  assert.deepEqual(
    whole.map((f) => f.id),
    clipped.map((f) => f.id),
  );
  assert.equal(
    roadLights(
      [
        feature([
          [139, 35],
          [140, 35],
        ]),
      ],
      10,
    ).length,
    10,
  );
  assert.equal(
    roadLights([
      {
        properties: { class: "primary", brunnel: "tunnel" },
        geometry: {
          type: "LineString",
          coordinates: [
            [139, 35],
            [140, 35],
          ],
        },
      },
    ]).length,
    0,
  );
});
import { expandFeature, visibilityFor } from "../light-geometry.mjs";
test("binary tile geometry decodes off-thread with polygon holes preserved", () => {
  const outer = [100, 100, 3900, 100, 3900, 3900, 100, 3900, 100, 100],
    hole = [1200, 1200, 1200, 2600, 2600, 2600, 2600, 1200, 1200, 1200];
  const decoded = expandFeature({
    tile: { x: 0, y: 0, z: 0 },
    type: 3,
    extent: 4096,
    coordinates: new Float32Array([...outer, ...hole]),
    ringLengths: [5, 5],
    properties: { class: "residential" },
  });
  assert.equal(decoded.geometry.type, "Polygon");
  assert.equal(decoded.geometry.coordinates.length, 2);
  assert.ok(decoded.geometry.coordinates.flat(2).every(Number.isFinite));
  const line = expandFeature({
    tile: { x: 0, y: 0, z: 0 },
    type: 2,
    extent: 4096,
    coordinates: new Float32Array([100, 100, 3900, 3900]),
    ringLengths: [2],
    properties: { class: "primary" },
  });
  assert.equal(line.geometry.type, "LineString");
  assert.equal(line.geometry.coordinates.length, 2);
});
test("viewport light budgeting rejects points behind the plane", () => {
  const view = {
    position: { lat: 0, lon: 0 },
    bearing: 0,
    tilt: 24,
    width: 1200,
    height: 800,
  };
  const visible = visibilityFor(view);
  assert.equal(visible([0, 0.2]), true);
  assert.equal(visible([0, -0.2]), false);
  const dateline = visibilityFor({
    ...view,
    position: { lat: 0, lon: 179.99 },
    bearing: 90,
  });
  assert.equal(dateline([-179.8, 0]), true);
});
