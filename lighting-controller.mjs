import { collectLightingGeometry } from "./map-lighting-source.mjs?v=1.1.3-06b3bb85";

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
    this.lastView = null;
    this.worker = null;
    try {
      this.worker = new Worker(
        new URL("./lights-worker.mjs?v=1.1.3-06b3bb85", import.meta.url),
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
    this.lastView = null;
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
    // Moving through already-loaded tiles does not emit new source-data events.
    // Refresh the visible light budget as the aircraft and its bank move too.
    const frame = this.getFrame();
    if (this.lastView) {
      const previous = this.lastView;
      const longitude = ((frame.position.lon - previous.lon + 540) % 360) - 180;
      const distance =
        Math.hypot(
          longitude * Math.cos((frame.position.lat * Math.PI) / 180),
          frame.position.lat - previous.lat,
        ) * 111195;
      if (distance >= 100 || Math.abs(frame.bank - previous.bank) >= 0.5)
        this.dirty = true;
    }
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
      this.lastView = { ...frame.position, bank: frame.bank };
    } catch {
      this.busy = false;
      this.dirty = true;
    }
  }
}
