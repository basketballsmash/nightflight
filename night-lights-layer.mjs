// Draws the generated city lights straight from a GPU buffer as a MapLibre
// custom layer. A GeoJSON source would first re-tile every light change on
// MapLibre's workers, so lights in a newly viewed direction appeared up to
// ~1.6 s late even though the data already existed. Here every light in the
// buffer is drawn on every frame, wherever the camera points.

// Same look as the former circle layers: [kind, size multiplier, blur, opacity].
const PASSES = [
  ["building", 3.4, 1, 0.18],
  ["building", 1, 0.18, 1],
  ["road", 2.8, 1, 0.13],
  ["road", 1, 0.15, 1],
];
const FLOATS = 8; // x, y, r, g, b, radius, opacity, born (ms)
// New lights fade in, so a tile of extra detail arriving mid-flight brightens
// gradually instead of popping in as a visible square.
export const FADE_IN_MS = 600;
const WORLD = 1; // mercator units

const VERTEX = `
attribute vec2 a_pos;
attribute vec3 a_color;
attribute vec2 a_size;
attribute float a_born;
uniform mat4 u_matrix;
uniform float u_now;
uniform float u_scale;
uniform float u_ratio;
varying vec3 v_color;
varying float v_opacity;
varying float v_radius;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
  v_radius = a_size.x * u_scale * u_ratio;
  v_color = a_color;
  v_opacity = a_size.y * clamp((u_now - a_born) / ${FADE_IN_MS.toFixed(1)}, 0.0, 1.0);
  gl_PointSize = 2.0 * v_radius + 2.0;
}`;
const FRAGMENT = `
precision mediump float;
uniform float u_blur;
uniform float u_opacity;
varying vec3 v_color;
varying float v_opacity;
varying float v_radius;
void main() {
  float size = 2.0 * v_radius + 2.0;
  float d = length((gl_PointCoord - 0.5) * size) / v_radius;
  float aa = 1.0 / max(v_radius, 0.01);
  float t = smoothstep(1.0 - max(u_blur, aa), 1.0, d);
  float alpha = v_opacity * u_opacity * (1.0 - t);
  gl_FragColor = vec4(v_color * alpha, alpha);
}`;

const colorCache = new Map();
function rgb(hex) {
  let value = colorCache.get(hex);
  if (!value) {
    const n = parseInt(String(hex).slice(1, 7), 16) || 0;
    value = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    colorCache.set(hex, value);
  }
  return value;
}
const mercatorX = (lon) => (lon + 180) / 360;
const mercatorY = (lat) => {
  const phi = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2;
};

/** Packs lights into [buildings..., roads...] relative to `center` (mercator). */
export function packLights(features, center, born = new Map()) {
  const buildings = [],
    roads = [];
  for (const feature of features)
    (feature.properties.kind === "road" ? roads : buildings).push(feature);
  const data = new Float32Array((buildings.length + roads.length) * FLOATS);
  let i = 0;
  for (const feature of [...buildings, ...roads]) {
    const [lon, lat] = feature.geometry.coordinates,
      p = feature.properties,
      color = rgb(p.color);
    let dx = mercatorX(lon) - center[0];
    dx -= Math.round(dx / WORLD) * WORLD; // across the date line
    data[i++] = dx;
    data[i++] = mercatorY(lat) - center[1];
    data[i++] = color[0];
    data[i++] = color[1];
    data[i++] = color[2];
    data[i++] = p.radius;
    data[i++] = p.opacity;
    data[i++] = born.get(feature.id) ?? -1e9;
  }
  return { data, buildings: buildings.length, roads: roads.length };
}

function multiply(a, b) {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  return out;
}
function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

export function createLightsLayer({
  id = "night-lights",
  now = () => performance.now(),
} = {}) {
  const features = new Map(),
    born = new Map();
  let map = null,
    program = null,
    buffer = null,
    locations = null,
    packed = null,
    center = [0.5, 0.5],
    dirty = true,
    fadingUntil = 0,
    epochStart = now();
  const changed = () => {
    dirty = true;
    map?.triggerRepaint();
  };
  return {
    id,
    type: "custom",
    renderingMode: "2d",
    get size() {
      return features.size;
    },
    applyDiff({ add = [], remove = [] }) {
      // Times are kept relative to the layer's start so float32 stays exact.
      const t = now() - epochStart;
      for (const key of remove) {
        features.delete(key);
        born.delete(key);
      }
      for (const feature of add) {
        // A light whose id already exists is an update, not a new light.
        if (!features.has(feature.id)) born.set(feature.id, t);
        features.set(feature.id, feature);
      }
      if (add.length) fadingUntil = t + FADE_IN_MS;
      if (add.length || remove.length) changed();
    },
    clear() {
      features.clear();
      born.clear();
      changed();
    },
    bornAt(key) {
      return born.get(key);
    },
    onAdd(m, gl) {
      map = m;
      program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program));
      locations = Object.fromEntries(
        ["a_pos", "a_color", "a_size", "a_born"].map((n) => [
          n,
          gl.getAttribLocation(program, n),
        ]),
      );
      for (const n of ["u_matrix", "u_scale", "u_ratio", "u_blur", "u_opacity", "u_now"])
        locations[n] = gl.getUniformLocation(program, n);
      buffer = gl.createBuffer();
      dirty = true;
    },
    onRemove(m, gl) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      map = program = buffer = null;
    },
    render(gl, options) {
      if (!program) return;
      const mapCenter = map.getCenter();
      if (dirty) {
        // Positions are stored relative to a nearby centre so float32 keeps
        // metre-level precision; the matrix adds the centre back in float64.
        center = [mercatorX(mapCenter.lng), mercatorY(mapCenter.lat)];
        packed = packLights(features.values(), center, born);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, packed.data, gl.DYNAMIC_DRAW);
        dirty = false;
      }
      if (!packed || !packed.data.length) return;
      const worldSize = map.transform?.worldSize ?? 512 * 2 ** map.getZoom();
      let cx = center[0];
      cx += Math.round(mercatorX(mapCenter.lng) - cx); // same world copy as the camera
      const model = new Float64Array([
        worldSize, 0, 0, 0,
        0, worldSize, 0, 0,
        0, 0, 1, 0,
        cx * worldSize, center[1] * worldSize, 0, 1,
      ]);
      const matrix = Float32Array.from(
        multiply(options.modelViewProjectionMatrix, model),
      );
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const stride = FLOATS * 4;
      gl.enableVertexAttribArray(locations.a_pos);
      gl.vertexAttribPointer(locations.a_pos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(locations.a_color);
      gl.vertexAttribPointer(locations.a_color, 3, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(locations.a_size);
      gl.vertexAttribPointer(locations.a_size, 2, gl.FLOAT, false, stride, 20);
      gl.enableVertexAttribArray(locations.a_born);
      gl.vertexAttribPointer(locations.a_born, 1, gl.FLOAT, false, stride, 28);
      const t = now() - epochStart;
      gl.uniform1f(locations.u_now, t);
      gl.uniformMatrix4fv(locations.u_matrix, false, matrix);
      gl.uniform1f(locations.u_ratio, map.getPixelRatio());
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (const [kind, scale, blur, opacity] of PASSES) {
        const first = kind === "road" ? packed.buildings : 0,
          count = kind === "road" ? packed.roads : packed.buildings;
        if (!count) continue;
        gl.uniform1f(locations.u_scale, scale);
        gl.uniform1f(locations.u_blur, blur);
        gl.uniform1f(locations.u_opacity, opacity);
        gl.drawArrays(gl.POINTS, first, count);
      }
      gl.disableVertexAttribArray(locations.a_pos);
      gl.disableVertexAttribArray(locations.a_color);
      gl.disableVertexAttribArray(locations.a_size);
      gl.disableVertexAttribArray(locations.a_born);
      // Keep drawing while lights are still fading in (e.g. when paused).
      if (t < fadingUntil) map.triggerRepaint();
    },
  };
}
