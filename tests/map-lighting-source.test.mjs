import test from "node:test";
import assert from "node:assert/strict";
import {
  tileDistance,
  collectLightingGeometry,
} from "../map-lighting-source.mjs";

const Z = 12,
  N = 2 ** Z,
  KM_PER_DEGREE = 111.195;
const row = (lat) => {
  const phi = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * N,
  );
};

test("tiles across the date line are measured on the nearest world copy", () => {
  const y = row(0.01),
    km = (x, origin) => tileDistance({ z: Z, x, y }, origin) / 1000;
  // 0.01° from the line, the neighbouring tile on the far side is ~1 km away.
  assert.ok(km(0, [179.99, 0.01]) < 1.2, "east of the line, seen from the west");
  assert.ok(km(N - 1, [-179.99, 0.01]) < 1.2, "west of the line, seen from the east");
  // One whole tile (0.088°) further round is still measured the short way.
  const next = km(1, [179.99, 0.01]);
  assert.ok(Math.abs(next - 0.0979 * KM_PER_DEGREE) < 0.1, `got ${next}`);
});

test("distance is unchanged away from the date line", () => {
  const origin = [139.7, 0.01],
    x = Math.floor(((origin[0] + 180) / 360) * N),
    y = row(origin[1]);
  assert.equal(tileDistance({ z: Z, x, y }, origin), 0, "inside its own tile");
  const km = tileDistance({ z: Z, x: x + 10, y }, origin) / 1000;
  assert.ok(km > 80 && km < 110, `got ${km}`);
  // A tile on the far side of the planet is ~20,000 km away, not ~0.
  const far = tileDistance({ z: Z, x: (x + N / 2) % N, y }, origin) / 1000;
  assert.ok(far > 19000, `got ${far}`);
});

test("a whole-world tile always contains the aircraft", () => {
  assert.equal(tileDistance({ z: 0, x: 0, y: 0 }, [179.99, 10]), 0);
  assert.equal(tileDistance({ z: 0, x: 0, y: 0 }, [-179.99, 10]), 0);
});

function fakeMap(canonicals, roads) {
  const queried = new Map(),
    tiles = new Map(
      canonicals.map((canonical, i) => [
        i,
        {
          tileID: { canonical },
          querySourceFeatures(output, { sourceLayer, filter }) {
            if (sourceLayer !== "transportation") return;
            const key = `${canonical.x}`,
              classes = queried.get(key) ?? [];
            classes.push(...filter.slice(2));
            queried.set(key, classes);
            output.push(...filter.slice(2).flatMap((c) => roads[c] ?? []));
          },
        },
      ]),
    );
  return {
    queried,
    style: {
      _globalState: {},
      projection: { worldCoordinateHelper: {} },
      tileManagers: {
        world: {
          getRenderableIds: () => [...tiles.keys()],
          getTileByID: (id) => tiles.get(id),
        },
      },
    },
  };
}

test("minor roads are collected from nearby tiles on both sides of the date line", async () => {
  const y = row(0.01),
    map = fakeMap(
      [
        { z: Z, x: N - 1, y }, // west of the line, under the aircraft
        { z: Z, x: 0, y }, // east of the line, ~1 km away
        { z: Z, x: 200, y }, // far away
      ],
      {},
    );
  await collectLightingGeometry(map, { origin: [179.99, 0.01] });
  const minor = (x) => map.queried.get(`${x}`).includes("minor");
  assert.equal(minor(N - 1), true);
  assert.equal(minor(0), true, "the neighbouring tile across the line");
  assert.equal(minor(200), false, "distant tiles still skip minor roads");
});
