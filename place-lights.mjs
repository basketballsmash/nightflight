// Cached artistic light points inside real mapped neighborhoods/buildings.
// No tile downloads, per-frame geometry processing, or geocoding happens here.
const R = 6378137,
  rad = Math.PI / 180;
const mercator = ([lon, lat]) => [
  R * lon * rad,
  R *
    Math.log(
      Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * rad) / 2),
    ),
];
const lngLat = ([x, y]) => [
  x / R / rad,
  (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / rad,
];
const hash = (x, y, salt = 0) => {
  let n = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ salt;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
export function insideRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function insidePolygon(point, rings) {
  return (
    rings.length > 0 &&
    insideRing(point, rings[0]) &&
    !rings.slice(1).some((ring) => insideRing(point, ring))
  );
}
// Density depends only on where a light is (its distance from the centre),
// never on the polygon it came from. Vector tiles clip one neighbourhood into
// per-tile pieces, so a per-polygon density made small clipped pieces glow far
// more densely than their neighbours, leaving tile-shaped boundaries.
export const NEAR_DISTANCE = 20000; // metres of full lattice density
// Gentle 1/d falloff: about as many lights per kilometre of distance near as
// far, which matches the former look while staying independent of tiles.
// It also fades to nothing between 40 and 65 km instead of stopping at a
// hard circle, which would read as a line across the view.
export const densityAt = (metres, near = NEAR_DISTANCE) =>
  Math.min(1, near / Math.max(metres, 1)) *
  Math.max(0, Math.min(1, (65000 - metres) / 25000));
const GRID = 160;
export function createPlaceLights(
  features,
  { center, maxPoints = 4500, nearDistance = NEAR_DISTANCE } = {},
) {
  const focus = mercator(center || [0, 0]),
    cos = Math.max(0.12, Math.cos((center?.[1] || 0) * rad)),
    limit = 65000 / cos,
    world = 2 * Math.PI * R,
    polygons = [];
  const offset = (x, y) => [
    ((x - focus[0] + world * 1.5) % world) - world / 2,
    y - focus[1],
  ];
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const groups =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    for (const group of groups) {
      if (!group?.[0]?.length) continue;
      const rings = group.map((ring) => ring.map(mercator)),
        outer = rings[0];
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const [x, y] of outer) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const [cx, cy] = offset((minX + maxX) / 2, (minY + maxY) / 2);
      if (Math.hypot(cx, cy) > limit + Math.hypot(maxX - minX, maxY - minY) / 2)
        continue;
      polygons.push({
        rings,
        minX,
        minY,
        maxX,
        maxY,
        building:
          feature.sourceLayer === "building" ||
          feature.properties?.lightBuilding === true,
      });
    }
  }
  const seen = new Set(),
    candidates = [];
  function consider(gx, gy, polygon, always) {
    const key = "b:" + gx + ":" + gy;
    if (seen.has(key)) return;
    const point = [
        (gx + 0.18 + hash(gx, gy, 1) * 0.64) * GRID,
        (gy + 0.18 + hash(gx, gy, 2) * 0.64) * GRID,
      ],
      [dx, dy] = offset(point[0], point[1]),
      distance = Math.hypot(dx, dy) * cos;
    if (distance > 65000) return;
    // Thin smoothly with distance (never by polygon), so there are no bands.
    if (!always && hash(gx, gy, 419) >= densityAt(distance, nearDistance))
      return;
    if (!insidePolygon(point, polygon.rings)) return;
    seen.add(key);
    if (hash(gx, gy, 107) < 0.13) return;
    candidates.push({ key, gx, gy, point, distance });
  }
  for (const polygon of polygons) {
    const { minX, minY, maxX, maxY } = polygon;
    if (polygon.building) {
      // One light per mapped building, at a stable lattice position.
      consider(
        Math.floor((minX + maxX) / (2 * GRID)),
        Math.floor((minY + maxY) / (2 * GRID)),
        polygon,
        true,
      );
      continue;
    }
    for (let gy = Math.ceil(minY / GRID - 1); gy * GRID <= maxY; gy++)
      for (let gx = Math.ceil(minX / GRID - 1); gx * GRID <= maxX; gx++)
        consider(gx, gy, polygon, false);
  }
  // Nearest first, so a full budget ends in a circle, not at polygon edges.
  candidates.sort((a, b) => a.distance - b.distance || (a.key < b.key ? -1 : 1));
  const points = candidates.slice(0, maxPoints).map(({ key, gx: x, gy: y, point }) => {
    const commercial = hash(x, y, 211) > 0.7,
      shade = hash(x, y, 173);
    const color =
      shade > 0.94
        ? "#a9c4e1"
        : shade > (commercial ? 0.69 : 0.87)
          ? "#e7ebdd"
          : shade > 0.58
            ? "#ffe3aa"
            : shade > 0.2
              ? "#f4b65c"
              : "#df893d";
    return {
      type: "Feature",
      id: key,
      _h: hash(x, y, 419),
      geometry: { type: "Point", coordinates: lngLat(point) },
      properties: {
        kind: "building",
        color,
        radius: (0.55 + hash(x, y, 31) * 0.7) * (commercial ? 1.15 : 1),
        opacity: 0.32 + hash(x, y, 53) * 0.58,
      },
    };
  });
  return { type: "FeatureCollection", features: points };
}
