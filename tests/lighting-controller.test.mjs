import test from "node:test";
import assert from "node:assert/strict";
import { LightingController } from "../lighting-controller.mjs";

test("cruising refreshes lights without tile events, within the update budget", async () => {
  const originalWorker = globalThis.Worker;
  const requests = [];
  globalThis.Worker = class {
    postMessage(message) {
      requests.push(message);
    }
  };
  try {
    const frame = {
      position: { lat: 0, lon: 179.999 },
      heading: 90,
      bank: 0,
      tilt: 24,
      yaw: 0,
      width: 1200,
      height: 800,
    };
    const map = {
      querySourceFeatures: () => [],
      getCenter: () => ({ lng: frame.position.lon, lat: 0 }),
    };
    const controller = new LightingController({
      getMap: () => map,
      getFrame: () => frame,
      isDragging: () => false,
    });
    await controller.update(1000, { ready: true, blocked: false });
    controller.receive({ epoch: 0 });
    assert.equal(requests.length, 1);
    frame.position = { lat: 0, lon: -179.998 };
    await controller.update(2000, { ready: true, blocked: false });
    assert.equal(requests.length, 1);
    await controller.update(4000, { ready: true, blocked: false });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].view.position, frame.position);
    controller.receive({ epoch: 0 });
    await controller.update(7000, { ready: true, blocked: false });
    assert.equal(
      requests.length,
      2,
      "stationary views avoid repeated geometry scans",
    );
    frame.bank = 2;
    await controller.update(7100, { ready: true, blocked: false });
    assert.equal(requests.length, 3);
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});
