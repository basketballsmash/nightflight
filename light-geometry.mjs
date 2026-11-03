// Runs off the UI thread. World-coordinate keys survive tile reloads and view changes.
const world = 40075016.68557849,
  rad = Math.PI / 180;
const project = ([lon, lat]) => [
  (lon / 360) * world,
  (Math.log(
    Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * rad) / 2),
  ) *
    world) /
    (2 * Math.PI),
];
const unproject = ([x, y]) => [
  (x / world) * 360,
  (2 * Math.atan(Math.exp((y / world) * 2 * Math.PI)) - Math.PI / 2) / rad,
];
const hash = (x, y, s = 0) => {
  let n = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ s;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
export function roadLights(
  features,
  maxPoints = 7000,
  acceptPoint = () => true,
) {
  const output = new Map();
  for (const feature of features) {
    const cls = feature.properties?.class;
    if (
      ![
        "motorway",
        "trunk",
        "primary",
        "secondary",
        "tertiary",
        "minor",
        "service",
      ].includes(cls) ||
      feature.properties?.brunnel === "tunnel"
    )
      continue;
    const major = ["motorway", "trunk", "primary", "secondary"].includes(cls),
      step = major ? 140 : 220,
      groups =
        feature.geometry?.type === "LineString"
          ? [feature.geometry.coordinates]
          : feature.geometry?.type === "MultiLineString"
            ? feature.geometry.coordinates
            : [];
    for (const line of groups)
      for (let i = 1; i < line.length; i++) {
        const a = project(line[i - 1]),
          b = project(line[i]),
          dx = b[0] - a[0],
          dy = b[1] - a[1];
        // Intersections with a fixed grid are unchanged when vector tiles clip a road.
        const axis = Math.abs(dx) >= Math.abs(dy) ? 0 : 1,
          delta = b[axis] - a[axis];
        if (Math.abs(delta) < 0.01) continue;
        const min = Math.min(a[axis], b[axis]),
          max = Math.max(a[axis], b[axis]);
        for (let cell = Math.ceil(min / step); cell * step <= max; cell++) {
          const t = (cell * step - a[axis]) / delta,
            x = a[0] + dx * t,
            y = a[1] + dy * t,
            key = "r:" + Math.round(x / 14) + ":" + Math.round(y / 14);
          if (output.has(key)) continue;
          const coordinates = unproject([x, y]);
          if (!acceptPoint(coordinates, feature)) continue;
          const r = hash(Math.round(x / 14), Math.round(y / 14), 17),
            white = cls === "motorway" || cls === "trunk";
          output.set(key, {
            type: "Feature",
            id: key,
            _zoom: feature.tile?.z ?? 0,
            geometry: { type: "Point", coordinates },
            properties: {
              kind: "road",
              color: white ? "#e8e6ce" : r > 0.8 ? "#ffe0a2" : "#efb25d",
              radius: major ? 0.85 + r * 0.35 : 0.5 + r * 0.3,
              opacity: major ? 0.65 + r * 0.3 : 0.35 + r * 0.3,
            },
          });
          if (output.size >= maxPoints) return [...output.values()];
        }
      }
  }
  return [...output.values()];
}
export function visibilityFor(view) {
  if (!view) return () => true;
  const origin = project([view.position.lon, view.position.lat]),
    bearing = view.bearing * rad,
    tilt = view.tilt * rad,
    focal = view.height / (2 * Math.tan(30 * rad)),
    down = 9000 / Math.cos(view.position.lat * rad),
    r = -(view.roll || 0) * rad;
  return (coordinates) => {
    const p = project(coordinates),
      dx = ((p[0] - origin[0] + world * 1.5) % world) - world / 2,
      dy = p[1] - origin[1],
      right = dx * Math.cos(bearing) - dy * Math.sin(bearing),
      forward = dx * Math.sin(bearing) + dy * Math.cos(bearing),
      depth = forward * Math.cos(tilt) + down * Math.sin(tilt);
    if (depth <= 1) return false;
    const xx = (right * focal) / depth,
      yy = ((down * Math.cos(tilt) - forward * Math.sin(tilt)) * focal) / depth,
      x = view.width / 2 + xx * Math.cos(r) - yy * Math.sin(r),
      y = view.height / 2 + xx * Math.sin(r) + yy * Math.cos(r);
    return (
      x >= -160 && x <= view.width + 160 && y >= -160 && y <= view.height + 160
    );
  };
}
// The main thread transfers raw MVT coordinates. Geographic projection and
// ring classification stay off the UI thread, including large urban polygons.
export function expandFeature(feature) {
  if (feature.geometry) return feature;
  const { tile, coordinates, ringLengths, extent = 4096, type } = feature,
    rings = [];
  let offset = 0;
  for (const length of ringLengths) {
    const ring = [];
    for (let i = 0; i < length; i++) {
      const x =
          (tile.x * extent + coordinates[offset++]) / (2 ** tile.z * extent),
        y = (tile.y * extent + coordinates[offset++]) / (2 ** tile.z * extent);
      ring.push([
        x * 360 - 180,
        Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / rad,
      ]);
    }
    rings.push(ring);
  }
  let geometry;
  if (type === 2)
    geometry =
      rings.length === 1
        ? { type: "LineString", coordinates: rings[0] }
        : { type: "MultiLineString", coordinates: rings };
  else if (type === 3) {
    const polygons = [];
    let winding;
    for (const ring of rings) {
      let area = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
        area += (ring[j][0] - ring[i][0]) * (ring[i][1] + ring[j][1]);
      if (!area) continue;
      const clockwise = area > 0;
      if (winding === undefined) winding = clockwise;
      if (clockwise === winding) polygons.push([ring]);
      else if (polygons.length) polygons[polygons.length - 1].push(ring);
    }
    geometry =
      polygons.length === 1
        ? { type: "Polygon", coordinates: polygons[0] }
        : { type: "MultiPolygon", coordinates: polygons };
  } else geometry = { type: "MultiPoint", coordinates: rings.flat() };
  return { tile, properties: feature.properties, geometry };
}

export { hash as lightHash };
