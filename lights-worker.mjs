import { createPlaceLights } from "./place-lights.mjs?v=1.1.2-65eb2218";
import {
  roadLights,
  visibilityFor,
  expandFeature,
  lightHash as hash,
} from "./light-geometry.mjs?v=1.1.2-65eb2218";
const rad = Math.PI / 180;

// Each flight owns a cache; the worker entry point only transports requests/results.
export function createLightProcessor() {
  let generation = -1;
  const cache = new Map();
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
      maxPoints = 12000,
    } = message;
    if (epoch !== generation) {
      generation = epoch;
      cache.clear();
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
      const buildings = createPlaceLights(areas, {
          center: focus,
          maxPoints: 4500,
        }),
        lamps = roadLights(
          nearRoads,
          30000,
          (coordinate, feature) =>
            visible(coordinate) &&
            (!feature.tile || feature.tile.z >= detailAt(coordinate)),
        );
      for (const feature of [
        ...buildings.features.filter((f) => visible(f.geometry.coordinates)),
        ...lamps,
      ])
        if (
          !cache.has(feature.id) ||
          (feature.properties.kind === "road" &&
            (cache.get(feature.id)._zoom ?? 0) < (feature._zoom ?? 0))
        ) {
          const c = feature.geometry.coordinates;
          feature._rank = hash(
            Math.round(c[0] * 100000),
            Math.round(c[1] * 100000),
            29,
          );
          cache.set(feature.id, feature);
        }
      const distance = (feature) => {
        const c = feature.geometry.coordinates;
        return (
          Math.hypot(
            (((c[0] - center[0] + 540) % 360) - 180) * cos,
            c[1] - center[1],
          ) * 111195
        );
      };
      for (const [key, feature] of cache)
        if (
          distance(feature) > 125000 ||
          (feature.properties.kind === "road" &&
            feature._zoom < detailAt(feature.geometry.coordinates))
        )
          cache.delete(key);
      const values = [...cache.values()];
      for (const feature of values)
        feature._visible = Number(visible(feature.geometry.coordinates));
      values.sort(
        (a, b) =>
          b._visible - a._visible ||
          a._rank - b._rank ||
          String(a.id).localeCompare(String(b.id)),
      );
      if (cache.size > 32000) {
        for (const feature of values.slice(32000)) cache.delete(feature.id);
      }
      return {
        id,
        epoch,
        data: {
          type: "FeatureCollection",
          features: values
            .slice(0, maxPoints)
            .sort((a, b) => String(a.id).localeCompare(String(b.id)))
            .map(({ _rank, _visible, _zoom, ...feature }) => feature),
        },
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
