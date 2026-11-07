import { clamp } from "./flight-math.mjs?v=1.1.3-7f057a33";
import { seededRandom } from "./flight-state.mjs?v=1.1.3-7f057a33";
import { meteorPath, skyClipPolygon } from "./view-math.mjs?v=1.1.3-7f057a33";
const RAD = Math.PI / 180,
  TAU = Math.PI * 2;

export class SkyRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.stars = Array.from({ length: 550 }, (_, index) => ({
      az: seededRandom(index, 1) * TAU,
      elevation: Math.asin(seededRandom(index, 2)),
      brightness: seededRandom(index, 3),
    }));
    this.reset();
  }
  reset() {
    this.meteor = null;
    this.nextMeteor = 5;
  }
  resize(width, height, pixelRatio) {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * pixelRatio);
    this.canvas.height = Math.round(height * pixelRatio);
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }
  clear() {
    this.context.clearRect(0, 0, this.width, this.height);
  }
  project(az, elevation, frame) {
    if (elevation <= 0.035) return null;
    const bearing = (frame.heading - 90 + frame.yaw) * RAD,
      tilt = frame.tilt * RAD,
      ce = Math.cos(elevation);
    const east = Math.sin(az) * ce,
      north = Math.cos(az) * ce,
      up = Math.sin(elevation);
    const right = east * Math.cos(bearing) - north * Math.sin(bearing),
      forward = east * Math.sin(bearing) + north * Math.cos(bearing);
    const depth = forward * Math.cos(tilt) - up * Math.sin(tilt);
    if (depth <= 0.01) return null;
    const focal = this.height / (2 * Math.tan(30 * RAD)),
      x = (right * focal) / depth,
      y = ((-up * Math.cos(tilt) - forward * Math.sin(tilt)) * focal) / depth,
      roll = -frame.bank * 0.5 * RAD;
    return {
      x: this.width / 2 + x * Math.cos(roll) - y * Math.sin(roll),
      y: this.height / 2 + x * Math.sin(roll) + y * Math.cos(roll),
    };
  }
  glow(x, y, radius, color, opacity) {
    if (x < -10 || x > this.width + 10 || y < -10 || y > this.height + 10)
      return;
    const ctx = this.context;
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.shadowBlur = radius * 4;
    ctx.shadowColor = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  drawStars(frame) {
    const ctx = this.context;
    for (const star of this.stars) {
      const point = this.project(star.az, star.elevation, frame);
      if (
        !point ||
        point.x < 0 ||
        point.x > this.width ||
        point.y < 0 ||
        point.y > this.height
      )
        continue;
      const size = star.brightness > 0.96 ? 1.3 : 0.7;
      ctx.globalAlpha = 0.15 + star.brightness * 0.4;
      ctx.fillStyle = "#d1dce7";
      ctx.fillRect(point.x, point.y, size, size);
    }
  }
  drawAircraft(frame) {
    for (let index = 0; index < 3; index++) {
      const along = 22000 - ((frame.time + index * 71) % 250) * 170,
        outward = 14000 + index * 8000,
        bearing = (frame.heading - 90) * RAD;
      const east = Math.sin(bearing) * outward + Math.cos(bearing) * along,
        north = Math.cos(bearing) * outward - Math.sin(bearing) * along;
      const point = this.project(
        Math.atan2(east, north),
        Math.atan2(2400 + index * 1800, Math.hypot(east, north)),
        frame,
      );
      if (!point) continue;
      this.glow(point.x, point.y, 0.7, "#e4e3d7", 0.6);
      this.glow(point.x - 1.2, point.y, 0.5, "#ef6354", 0.65);
      if ((frame.time + index * 0.43) % 1.4 < 0.09)
        this.glow(point.x, point.y, 1.4, "#eff6ff", 0.9);
    }
  }
  drawMeteor(frame, dt) {
    this.nextMeteor -= dt;
    if (this.nextMeteor <= 0) {
      this.meteor = {
        az:
          (frame.heading - 90 + frame.yaw) * RAD + (Math.random() - 0.5) * 0.6,
        elevation: clamp(
          -frame.tilt * RAD + 0.2 + Math.random() * 0.3,
          0.15,
          1.3,
        ),
        va: (Math.random() < 0.5 ? -1 : 1) * 0.35,
        t: 0,
      };
      this.nextMeteor = 18 + Math.random() * 23;
    }
    const meteor = this.meteor;
    if (!meteor) return;
    meteor.t += dt;
    if (meteor.t > 1.05) {
      this.meteor = null;
      return;
    }
    const head = meteorPath(meteor, meteor.t),
      tail = meteorPath(meteor, Math.max(0, meteor.t - 0.14));
    const a = this.project(head.az, head.elevation, frame),
      b = this.project(tail.az, tail.elevation, frame);
    if (!a || !b) return;
    const ctx = this.context,
      gradient = ctx.createLinearGradient(b.x, b.y, a.x, a.y);
    gradient.addColorStop(0, "#cddfff00");
    gradient.addColorStop(1, "#e3efff");
    ctx.globalAlpha = Math.sin((meteor.t / 1.05) * Math.PI);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(a.x, a.y);
    ctx.stroke();
  }
  draw(frame, dt) {
    this.clear();
    const ctx = this.context;
    ctx.save();
    ctx.beginPath();
    skyClipPolygon(
      this.width,
      this.height,
      frame.tilt,
      frame.bank * 0.5,
    ).forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    this.drawStars(frame);
    this.drawAircraft(frame);
    this.drawMeteor(frame, dt);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
