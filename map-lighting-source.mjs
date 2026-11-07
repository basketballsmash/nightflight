// The only adapter coupled to the pinned MapLibre tile representation.
// Keep geometry as transferable MVT coordinates until it reaches the worker.
// Minor roads are faded out by 13 km (lights-worker.mjs), so only nearby
// tiles need them; there they are taken whole instead of thinned per tile,
// which used to make busy tiles sparser than quiet neighbours.
const MAJOR_ROADS = ["motorway", "trunk", "primary", "secondary", "tertiary"],
  MINOR_ROADS = ["minor", "service"],
  MINOR_RANGE = 15000;
function tileDistance(canonical, origin) {
  const n = 2 ** canonical.z,
    lon = (x) => (x / n) * 360 - 180,
    lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
    west = lon(canonical.x),
    east = lon(canonical.x + 1),
    north = lat(canonical.y),
    south = lat(canonical.y + 1),
    cx = Math.max(west, Math.min(east, origin[0])),
    cy = Math.max(south, Math.min(north, origin[1]));
  return (
    Math.hypot(
      (cx - origin[0]) * Math.cos((origin[1] * Math.PI) / 180),
      cy - origin[1],
    ) * 111195
  );
}
export async function collectLightingGeometry(
  map,
  { isCancelled = () => false, origin = null } = {},
) {
  const areas = [],
    roads = [],
    tiles = [],
    transfers = [];
  const yieldUI = () => new Promise((resolve) => setTimeout(resolve, 0));
  const plain = (feature, building = false) => {
    const properties = {
        class: feature.properties?.class,
        brunnel: feature.properties?.brunnel,
        lightBuilding: building,
      },
      vector = feature._vectorTileFeature,
      tile = feature.tile || { x: feature._x, y: feature._y, z: feature._z };
    if (!vector) return { geometry: feature.geometry, tile, properties };
    const rings = vector.loadGeometry(),
      ringLengths = rings.map((r) => r.length),
      coordinates = new Float32Array(
        ringLengths.reduce((sum, n) => sum + n, 0) * 2,
      );
    let i = 0;
    for (const ring of rings)
      for (const p of ring) {
        coordinates[i++] = p.x;
        coordinates[i++] = p.y;
      }
    transfers.push(coordinates.buffer);
    return {
      tile,
      properties,
      type: vector.type,
      extent: vector.extent,
      ringLengths,
      coordinates,
    };
  };

  // MapLibre is pinned in vendor/. Its per-tile adapter lets us yield between
  // tiles instead of running one large, synchronous querySourceFeatures scan.
  const style = map.style,
    manager = style?.tileManagers?.world,
    ids = manager?.getRenderableIds?.(),
    seen = new Set();
  let deadline = performance.now() + 3;
  if (ids) {
    // Generous: dropping a clipped polygon piece leaves a tile-shaped hole.
    const areaQuota = Math.max(40, Math.ceil(4000 / Math.max(1, ids.length)));
    for (const id of ids) {
      const tile = manager.getTileByID(id),
        canonical = tile?.tileID?.canonical;
      if (!tile || !canonical) continue;
      const key = canonical.z + ":" + canonical.x + ":" + canonical.y;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push({ x: canonical.x, y: canonical.y, z: canonical.z });
      const near = !origin || tileDistance(canonical, origin) < MINOR_RANGE;
      for (const [layer, allowed, output, quota] of [
        [
          "landuse",
          ["residential", "commercial", "retail", "industrial"],
          areas,
          areaQuota,
        ],
        ["transportation", MAJOR_ROADS, roads, 4000],
        ...(near ? [["transportation", MINOR_ROADS, roads, 6000]] : []),
      ]) {
        const features = [];
        tile.querySourceFeatures(features, {
          sourceLayer: layer,
          filter: ["in", "class", ...allowed],
          globalState: style._globalState,
          worldCoordinateHelper: style.projection.worldCoordinateHelper,
        });
        const stride = Math.max(1, Math.ceil(features.length / quota));
        for (let i = 0; i < features.length; i += stride) {
          output.push(plain(features[i]));
          if (performance.now() > deadline) {
            await yieldUI();
            deadline = performance.now() + 3;
            if (isCancelled()) return null;
          }
        }
        if (performance.now() > deadline) {
          await yieldUI();
          deadline = performance.now() + 3;
        }
      }
    }
  } else {
    // Compatibility fallback if the vendored renderer is replaced in the future.
    for (const [layer, output] of [
      ["landuse", areas],
      ["transportation", roads],
    ]) {
      const features = map.querySourceFeatures("world", { sourceLayer: layer });
      const stride = Math.max(1, Math.ceil(features.length / 1500));
      for (let i = 0; i < features.length; i += stride) {
        output.push(plain(features[i]));
        if (performance.now() > deadline) {
          await yieldUI();
          deadline = performance.now() + 3;
        }
      }
    }
  }
  if (isCancelled()) return null;

  return { areas, roads, tiles, transfers };
}
