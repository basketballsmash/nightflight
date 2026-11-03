import { normalizeLocation } from "./flight-math.mjs?v=1.1.2-65eb2218";

export class SearchThrottleError extends Error {}
function browserStorage() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

export class PlaceSearch {
  constructor(
    endpoint,
    {
      fetchImpl = (...args) => globalThis.fetch(...args),
      storage = browserStorage(),
      now = () => performance.now(),
    } = {},
  ) {
    this.endpoint = endpoint;
    this.fetch = fetchImpl;
    this.storage = storage;
    this.now = now;
    this.cache = new Map();
    this.lastRequest = -Infinity;
    this.controller = null;
    this.busy = false;
  }
  abort() {
    this.controller?.abort();
  }
  async search(query) {
    const key = query.toLocaleLowerCase();
    let features = this.cache.get(key);
    if (!features) {
      try {
        const saved = JSON.parse(
          this.storage?.getItem("nightflight-search:" + key),
        );
        if (
          saved &&
          Date.now() - saved.time < 86400000 &&
          Array.isArray(saved.features)
        )
          features = saved.features;
      } catch {}
    }
    if (features) return features;
    if (this.now() - this.lastRequest < 1200)
      throw new SearchThrottleError(
        "Please wait a moment before searching again.",
      );
    this.busy = true;
    this.lastRequest = this.now();
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const url = new URL(this.endpoint);
      url.searchParams.set("q", query);
      url.searchParams.set("limit", "6");
      url.searchParams.set("lang", "en");
      const response = await this.fetch(url, {
        signal: controller.signal,
        credentials: "omit",
      });
      if (!response.ok) throw new Error("Search unavailable");
      const data = await response.json();
      features = Array.isArray(data.features) ? data.features : [];
      this.cache.set(key, features);
      try {
        this.storage?.setItem(
          "nightflight-search:" + key,
          JSON.stringify({ time: Date.now(), features }),
        );
      } catch {}
      return features;
    } finally {
      clearTimeout(timeout);
      this.busy = false;
    }
  }
}

export function searchResults(features) {
  const results = [],
    seen = new Set();
  for (const feature of features) {
    const properties = feature.properties || {},
      coordinates = feature.geometry?.coordinates;
    if (!Array.isArray(coordinates)) continue;
    const name = String(properties.name || properties.city || "Selected place");
    const detail = [properties.city, properties.state, properties.country]
      .filter(
        (value, index, all) =>
          value && value !== name && all.indexOf(value) === index,
      )
      .join(", ");
    const place = normalizeLocation({
      lat: coordinates[1],
      lon: coordinates[0],
      name: detail ? `${name}, ${detail}` : name,
    });
    if (!place) continue;
    const key = (name + "|" + detail).toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      name,
      detail: detail || `${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}`,
      place,
    });
  }
  return results;
}
