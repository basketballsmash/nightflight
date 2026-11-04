import { clamp } from "./flight-math.mjs?v=1.1.3-481c94c1";
import { VIEW_LIMITS, wrapAngle } from "./view-math.mjs?v=1.1.3-481c94c1";

export class ViewControls {
  constructor(canvas, { reducedMotion = false, onChange = () => {} } = {}) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    this.onChange = onChange;
    this.tilt = this.targetTilt = 24;
    this.yaw = this.targetYaw = 0;
    this.drag = null;
    canvas.addEventListener("pointerdown", (event) => this.beginDrag(event));
    canvas.addEventListener("pointermove", (event) => this.dragTo(event));
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      canvas.addEventListener(type, (event) => this.endDrag(event));
    canvas.addEventListener("dblclick", () => this.reset());
  }
  get isDragging() {
    return this.drag !== null;
  }
  reset() {
    this.tilt = this.targetTilt = 24;
    this.yaw = this.targetYaw = 0;
    this.onChange(false);
  }
  move(dx, dy) {
    dx = clamp(Number.isFinite(dx) ? dx : 0, -160, 160);
    dy = clamp(Number.isFinite(dy) ? dy : 0, -160, 160);
    this.targetTilt = clamp(
      this.targetTilt - dy * 0.05,
      VIEW_LIMITS.minTilt,
      VIEW_LIMITS.maxTilt,
    );
    this.targetYaw = wrapAngle(this.targetYaw - dx * 0.055);
    this.onChange(true);
  }
  update(dt) {
    const tiltDelta = this.targetTilt - this.tilt,
      yawDelta = wrapAngle(this.targetYaw - this.yaw);
    if (Math.abs(tiltDelta) < 0.003 && Math.abs(yawDelta) < 0.003) {
      const changed =
        this.tilt !== this.targetTilt || this.yaw !== this.targetYaw;
      this.tilt = this.targetTilt;
      this.yaw = this.targetYaw;
      return changed;
    }
    const gain = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 7);
    this.tilt += tiltDelta * gain;
    this.yaw = wrapAngle(this.yaw + yawDelta * gain);
    return true;
  }
  beginDrag(event) {
    if (!event.isPrimary || event.button !== 0 || this.drag) return;
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.classList.add("dragging");
    this.canvas.focus({ preventScroll: true });
    this.onChange(false);
  }
  dragTo(event) {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    this.move(event.clientX - this.drag.x, event.clientY - this.drag.y);
    this.drag.x = event.clientX;
    this.drag.y = event.clientY;
  }
  endDrag(event) {
    if (this.drag?.id !== event.pointerId) return;
    this.drag = null;
    this.canvas.classList.remove("dragging");
  }
}
