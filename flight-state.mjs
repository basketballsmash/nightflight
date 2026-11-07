import { clamp, destination } from "./flight-math.mjs?v=1.1.3-e4223098";

export function seededRandom(number, salt = 0) {
  let value = Math.imul(number, 374761393) ^ Math.imul(salt, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
export function smoothStep(value) {
  value = clamp(value, 0, 1);
  return value * value * (3 - 2 * value);
}
export function bankAt(time, seed, reducedMotion = false) {
  if (reducedMotion) return 0;
  const segment = Math.floor(time / 125),
    local = time % 125;
  const start = 18 + seededRandom(segment, seed) * 14,
    duration = 38 + seededRandom(segment, seed + 1) * 14;
  if (local < start || local > start + duration) return 0;
  const progress = (local - start) / duration,
    direction = seededRandom(segment, seed + 2) > 0.5 ? 1 : -1;
  return (
    direction *
    (4 + seededRandom(segment, seed + 3) * 3) *
    smoothStep(progress / 0.3) *
    smoothStep((1 - progress) / 0.3)
  );
}

export class FlightState {
  constructor(
    location,
    { speed, reducedMotion = false, seed = Math.floor(Math.random() * 100000) },
  ) {
    this.speed = speed;
    this.reducedMotion = reducedMotion;
    this.seed = seed;
    this.start(location);
  }
  start(location) {
    this.location = location;
    this.position = { lat: location.lat, lon: location.lon };
    this.heading = location.heading;
    this.time = 0;
    this.bank = 0;
    this.paused = false;
  }
  advance(dt) {
    this.time += dt;
    this.bank = bankAt(this.time, this.seed, this.reducedMotion);
    this.heading =
      (this.heading +
        ((Math.tan((this.bank * Math.PI) / 180) * 9.80665) /
          this.speed /
          (Math.PI / 180)) *
          dt +
        360) %
      360;
    if (this.position.lat > 84.5) this.heading = 180;
    if (this.position.lat < -84.5) this.heading = 0;
    this.position = destination(this.position, this.heading, this.speed * dt);
  }
  setHeading(heading) {
    this.heading = heading;
    this.location = { ...this.location, heading };
  }
}
