import test from "node:test";
import assert from "node:assert/strict";
import { FlightState, bankAt } from "../flight-state.mjs";
import {
  PlaceSearch,
  SearchThrottleError,
  searchResults,
} from "../place-search.mjs";

test("starting a new flight resets motion without modifying its origin", () => {
  const origin = { lat: 35, lon: 139, heading: 90, name: "Tokyo" };
  const flight = new FlightState(origin, { speed: 235, seed: 12 });
  flight.advance(1);
  assert.ok(flight.position.lon > origin.lon);
  assert.equal(origin.lon, 139);
  flight.paused = true;
  flight.start(origin);
  assert.deepEqual(flight.position, { lat: 35, lon: 139 });
  assert.equal(flight.time, 0);
  assert.equal(flight.bank, 0);
  assert.equal(flight.paused, false);
});

test("banking stays gentle and respects reduced motion throughout a flight", () => {
  for (let time = 0; time < 1000; time += 0.5) {
    assert.ok(Math.abs(bankAt(time, 42)) <= 7);
    assert.equal(bankAt(time, 42, true), 0);
  }
});

test("search cache avoids repeat network requests while new queries are throttled", async () => {
  let requests = 0,
    now = 0;
  const features = [
    { properties: { name: "Tokyo" }, geometry: { coordinates: [139, 35] } },
  ];
  const service = new PlaceSearch("https://example.test/search", {
    storage: null,
    now: () => now,
    fetchImpl: async () => {
      requests++;
      return { ok: true, json: async () => ({ features }) };
    },
  });
  assert.deepEqual(await service.search("Tokyo"), features);
  assert.deepEqual(await service.search("TOKYO"), features);
  assert.equal(requests, 1);
  await assert.rejects(service.search("London"), SearchThrottleError);
  now = 1200;
  await service.search("London");
  assert.equal(requests, 2);
  assert.equal(service.busy, false);
  assert.equal(searchResults([...features, ...features]).length, 1);
});
