import { createPlaceLights, densityAt } from "./place-lights.mjs?v=1.1.3-e4223098";
import {
  roadLights,
  lampPriority,
  visibilityFor,
  expandFeature,
  lightHash as hash,
} from "./light-geometry.mjs?v=1.1.3-e4223098";
const rad = Math.PI / 180;

// Lights are generated for everything the loaded tiles cover, not only for the
// current view, so looking around reveals lights that already exist. The view
// only decides priority: visible lights first, then the nearest hidden ones.
// The GPU layer draws points cheaply, so the budgets are generous.
export const VISIBLE_BUDGET = 24000;
export const TOTAL_BUDGET = 34000;
const ROAD_LAMP_CAP = 50000;
const BUILDING_SHARE = 0.35; // of the visible budget, when that many exist
const CACHE_LIMIT = 60000;
const signatureOf = (feature) => {
  const c = feature.geometry.coordinates,
    p = feature.properties;
  return `${c[0]},${c[1]},${p.color},${p.radius},${p.opacity}`;
};
const strip = ({ _rank, _visible, _zoom, _distance, _h, _cls, ...feature }) =>
  feature;
// Smaller roads only exist in the more detailed tiles MapLibre loads nearby:
// minor roads only in zoom 12 (about 20 km out), tertiary in zoom 11-12
// (about 36 km). Fade them out well inside that, by distance, so their absence
// farther away never shows up as a tile-shaped edge. [start, end] metres.
const ROAD_FADE = {
  tertiary: [14000, 26000], // present in zoom 11 and 12 tiles (to ~36 km)
  minor: [5000, 13000],
  service: [4000, 11000],
};
// Major roads exist at every zoom; they only thin gently with distance (~1/d
// beyond 40 km), which keeps the horizon from saturating and the lamp count
// bounded without cutting anything off.
const MAJOR_NEAR = 40000;
export function fadeAt(cls, metres) {
  const range = ROAD_FADE[cls];
  if (!range) return Math.min(1, MAJOR_NEAR / Math.max(metres, 1));
  return Math.max(0, Math.min(1, (range[1] - metres) / (range[1] - range[0])));
}
// Whether a light belongs at this distance; the same rule decides generation
// and eviction, so lights made when nearer do not linger as dense patches.
export function keepAt(feature, metres) {
  const h = feature._h ?? 0;
  return feature.properties.kind === "road"
    ? h < fadeAt(feature._cls, metres)
    : h < densityAt(metres);
}

// Each flight owns a cache; the worker entry point only transports requests/results.
// Results are diffs against what this processor last returned, for
// GeoJSONSource.updateData, so unchanged lights are never re-sent.
export function createLightProcessor() {
  let generation = -1;
  const cache = new Map(),
    sent = new Map();
  return (message) => {
    const {
      id,
      epoch,
      areas: rawAreas,
      roads: rawRoads,
      tiles = [],
      center,
      focus = center,
      view,
      visibleBudget = VISIBLE_BUDGET,
      maxPoints = TOTAL_BUDGET,
    } = message;
    if (epoch !== generation) {
      generation = epoch;
      cache.clear();
      sent.clear();
    }
    try {
      const areas = rawAreas.map(expandFeature),
        roads = rawRoads.map(expandFeature);
      const tileSet = new Set(tiles.map((t) => t.z + ":" + t.x + ":" + t.y)),
        zooms = [...new Set(tiles.map((t) => t.z))].sort((a, b) => b - a);
      const detailAt = (coordinates) => {
        for (const z of zooms) {
          const n = 2 ** z,
            x = Math.floor(
              (((((coordinates[0] + 180) % 360) + 360) % 360) / 360) * n,
            ),
            phi = Math.max(-85, Math.min(85, coordinates[1])) * rad,
            y = Math.floor(
              ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) *
                n,
            );
          if (tileSet.has(z + ":" + x + ":" + y)) return z;
        }
        return 0;
      };
      const visible = visibilityFor(view),
        cos = Math.max(0.12, Math.cos(focus[1] * rad)),
        distTo = (c) =>
          Math.hypot(
            (((c[0] - center[0] + 540) % 360) - 180) * cos,
            c[1] - center[1],
          ) * 111195,
        nearRoads = roads
          .map((feature) => {
            const c =
              feature.geometry?.type === "LineString"
                ? feature.geometry.coordinates[0]
                : feature.geometry?.coordinates?.[0]?.[0];
            return {
              feature,
              d: c
                ? hash(Math.round(c[0] * 10000), Math.round(c[1] * 10000), 97)
                : Infinity,
            };
          })
          .sort((a, b) => a.d - b.d)
          .map((entry) => entry.feature);
      const detailed = (coordinate, feature, lod) =>
        (!feature.tile || feature.tile.z >= detailAt(coordinate)) &&
        lod < fadeAt(feature.properties?.class, distTo(coordinate));
      // Visible roads get the budget first, so a busy hidden area can never
      // crowd out what is on screen; hidden roads fill what remains.
      const visibleLamps = roadLights(
          nearRoads,
          ROAD_LAMP_CAP,
          (coordinate, feature, lod) =>
            visible(coordinate) && detailed(coordinate, feature, lod),
        ),
        hiddenLamps = roadLights(
          nearRoads,
          Math.max(0, ROAD_LAMP_CAP - visibleLamps.length),
          (coordinate, feature, lod) =>
            !visible(coordinate) && detailed(coordinate, feature, lod),
        ),
        // Density is measured from the aircraft, not the view centre, so
        // looking around never reshuffles which building lights exist.
        // Generous cap: the visible share below does the even thinning, so
        // the nearest-first cap should rarely cut (it would cut in a circle).
        buildings = createPlaceLights(areas, {
          center,
          maxPoints: 20000,
        });
      // Building lights are fully regenerated wherever tiles are loaded now;
      // older ones there (e.g. from a different distance) must not linger.
      const freshBuildings = new Set();
      for (const feature of buildings.features) freshBuildings.add(feature.id);
      for (const [key, feature] of cache)
        if (
          feature.properties.kind === "building" &&
          !freshBuildings.has(key) &&
          detailAt(feature.geometry.coordinates) > 0
        )
          cache.delete(key);
      for (const feature of [
        ...buildings.features,
        ...visibleLamps,
        ...hiddenLamps,
      ])
        if (
          !cache.has(feature.id) ||
          (feature.properties.kind === "road" &&
            (cache.get(feature.id)._zoom ?? 0) < (feature._zoom ?? 0))
        ) {
          const c = feature.geometry.coordinates,
            rank = hash(Math.round(c[0] * 100000), Math.round(c[1] * 100000), 29);
          feature._rank =
            feature.properties.kind === "road" ? lampPriority(feature, rank) : rank;
          cache.set(feature.id, feature);
        }
      const distance = (feature) => distTo(feature.geometry.coordinates);
      for (const [key, feature] of cache)
        if (
          distance(feature) > 125000 ||
          !keepAt(feature, distance(feature)) ||
          (feature.properties.kind === "road" &&
            feature._zoom < detailAt(feature.geometry.coordinates))
        )
          cache.delete(key);
      const shown = [],
        hidden = [];
      for (const feature of cache.values()) {
        if (visible(feature.geometry.coordinates)) shown.push(feature);
        else {
          feature._distance = distance(feature);
          hidden.push(feature);
        }
      }
      shown.sort(
        (a, b) => a._rank - b._rank || String(a.id).localeCompare(String(b.id)),
      );
      hidden.sort(
        (a, b) =>
          a._distance - b._distance || String(a.id).localeCompare(String(b.id)),
      );
      // Priority order: visible (thinned evenly by rank) up to its budget,
      // then the nearest hidden lights, then any remaining visible ones.
      // Buildings get their own share, so dense road networks cannot crowd
      // out the neighbourhood glow.
      const shownBuildings = shown.filter((f) => f.properties.kind === "building"),
        shownRoads = shown.filter((f) => f.properties.kind !== "building"),
        buildingShare = Math.min(
          shownBuildings.length,
          Math.round(visibleBudget * BUILDING_SHARE),
        ),
        roadShare = Math.min(shownRoads.length, visibleBudget - buildingShare),
        // Leftover share goes back to buildings when roads are few.
        extraBuildings = Math.min(
          shownBuildings.length - buildingShare,
          visibleBudget - buildingShare - roadShare,
        );
      const firstBuildings = buildingShare + extraBuildings;
      const ordered = [
        ...shownBuildings.slice(0, firstBuildings),
        ...shownRoads.slice(0, roadShare),
        ...hidden,
        ...shownBuildings.slice(firstBuildings),
        ...shownRoads.slice(roadShare),
      ];
      for (const feature of ordered.slice(CACHE_LIMIT)) cache.delete(feature.id);
      const selected = ordered.slice(0, maxPoints),
        add = [],
        remove = [],
        next = new Map();
      for (const feature of selected) {
        const signature = signatureOf(feature);
        next.set(feature.id, signature);
        if (sent.get(feature.id) !== signature) add.push(strip(feature));
      }
      for (const key of sent.keys()) if (!next.has(key)) remove.push(key);
      sent.clear();
      for (const [key, signature] of next) sent.set(key, signature);
      return {
        id,
        epoch,
        count: selected.length,
        visible: Math.min(shown.length, maxPoints),
        diff: { add, remove },
      };
    } catch (error) {
      return { id, epoch, error: String(error.message || error) };
    }
  };
}

if (typeof self !== "undefined") {
  const process = createLightProcessor();
  self.onmessage = (event) => self.postMessage(process(event.data));
}
