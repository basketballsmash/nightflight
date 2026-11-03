const rad = Math.PI / 180,
  world = 2 * Math.PI * 6371008.8;
export const VIEW_LIMITS = Object.freeze({ minTilt: -32, maxTilt: 78 });
export const wrapAngle = (angle) => ((((angle + 180) % 360) + 360) % 360) - 180;
export function flightCamera({
  position,
  heading = 90,
  yaw = 0,
  tilt = 24,
  altitude = 9000,
  height = 900,
  roll = 0,
}) {
  // Work from the aircraft position every time; never inherit target elevation
  // from a previous sky view. A bounded target distance avoids the horizon singularity.
  tilt = Math.max(VIEW_LIMITS.minTilt, Math.min(VIEW_LIMITS.maxTilt, tilt));
  const phi = Math.max(-85, Math.min(85, position.lat)) * rad,
    scale = 1 / (world * Math.cos(phi));
  const x = (position.lon + 180) / 360,
    y = (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2;
  const bearing = wrapAngle(heading - 90 + yaw),
    distance = altitude / Math.sin(Math.max(12, tilt) * rad),
    horizontal = distance * Math.cos(tilt * rad) * scale;
  const tx = x + Math.sin(bearing * rad) * horizontal,
    ty = y - Math.cos(bearing * rad) * horizontal;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * ty))) / rad,
    lon = tx * 360 - 180;
  const elevation =
    (altitude - distance * Math.sin(tilt * rad)) *
    scale *
    world *
    Math.cos(lat * rad);
  return {
    center: [lon, lat],
    elevation,
    zoom: Math.log2(
      height / (2 * Math.tan(30 * rad)) / (distance * scale * 512),
    ),
    bearing,
    pitch: 90 - tilt,
    roll,
  };
}
export function meteorPath(meteor, t) {
  const duration = meteor.duration ?? 1.05,
    progress = Math.max(0, Math.min(duration, t));
  // End the streak well above the geometric horizon, including its tail.
  const drop = Math.min(0.18, Math.max(0, meteor.elevation - 0.09));
  return {
    az: meteor.az + meteor.va * progress,
    elevation: meteor.elevation - (drop * progress) / duration,
  };
}
export function skyClipPolygon(width, height, tilt, roll = 0) {
  const focal = height / (2 * Math.tan(30 * rad)),
    r = -roll * rad,
    A = -Math.sin(r),
    B = Math.cos(r),
    C =
      (Math.sin(r) * width) / 2 -
      (Math.cos(r) * height) / 2 +
      focal * Math.tan(tilt * rad);
  const corners = [
      [-2, -2],
      [width + 2, -2],
      [width + 2, height + 2],
      [-2, height + 2],
    ],
    output = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i],
      b = corners[(i + 1) % corners.length],
      da = A * a[0] + B * a[1] + C,
      db = A * b[0] + B * b[1] + C;
    if (da <= 0) output.push(a);
    if (da <= 0 !== db <= 0) {
      const t = da / (da - db);
      output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return output;
}
