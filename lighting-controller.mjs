import { collectLightingGeometry } from "./map-lighting-source.mjs?v=1.1.2-65eb2218";

const emptyLights = () => ({ type: "FeatureCollection", features: [] });
export class LightingController {
  constructor({ getMap, getFrame, isDragging }) {
    this.getMap = getMap;
    this.getFrame = getFrame;
    this.isDragging = isDragging;
    this.dirty = true;
    this.viewDirty = true;
    this.lastRequest = -Infinity;
    this.lastInteraction = 0;
    this.busy = false;
    this.epoch = 0;
    this.requestId = 0;
    this.signature = "";
    this.worker = null;
    try {
      this.worker = new Worker(
        new URL("./lights-worker.mjs?v=1.1.2-65eb2218", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (event) => this.receive(event.data);
      this.worker.onerror = () => {
        this.busy = false;
      };
    } catch {
      this.worker = null;
    }
  }
  markDataChanged(now) {
    this.dirty = true;
    if (now - this.lastInteraction < 2500) this.viewDirty = true;
  }
  markViewChanged(now) {
    this.dirty = true;
    this.viewDirty = true;
    this.lastInteraction = now;
  }
  reset(now) {
    this.markViewChanged(now);
    this.lastRequest = -Infinity;
    this.epoch++;
    this.signature = "";
    this.getMap()?.getSource("place-lights")?.setData(emptyLights());
  }
  receive(result) {
    this.busy = false;
    if (result.epoch !== this.epoch || result.error || !result.data) return;
    const signature = result.data.features
      .map((feature) => feature.id)
      .join("|");
    if (signature === this.signature) return;
    this.signature = signature;
    this.getMap()?.getSource("place-lights")?.setData(result.data);
  }
  async update(now, { ready, blocked }) {
    const delay = this.viewDirty ? 900 : 3000;
    if (
      !ready ||
      blocked ||
      this.isDragging() ||
      now - this.lastInteraction < 450 ||
      !this.dirty ||
      this.busy ||
      !this.worker ||
      now - this.lastRequest < delay
    )
      return;
    this.dirty = false;
    this.viewDirty = false;
    this.lastRequest = now;
    this.busy = true;
    const epoch = this.epoch;
    try {
      const geometry = await collectLightingGeometry(this.getMap(), {
        isCancelled: () => epoch !== this.epoch || this.isDragging(),
      });
      if (!geometry) {
        this.busy = false;
        this.dirty = true;
        return;
      }
      if (epoch !== this.epoch) {
        this.busy = false;
        return;
      }
      const frame = this.getFrame(),
        center = this.getMap().getCenter();
      this.worker.postMessage(
        {
          id: ++this.requestId,
          epoch,
          areas: geometry.areas,
          roads: geometry.roads,
          tiles: geometry.tiles,
          center: [frame.position.lon, frame.position.lat],
          focus: [center.lng, center.lat],
          view: {
            position: { ...frame.position },
            width: frame.width,
            height: frame.height,
            tilt: frame.tilt,
            bearing: frame.heading - 90 + frame.yaw,
            roll: frame.bank * 0.5,
          },
          maxPoints: 12000,
        },
        geometry.transfers,
      );
    } catch {
      this.busy = false;
      this.dirty = true;
    }
  }
}
