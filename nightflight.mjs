import * as maplibre from "./vendor/maplibre-gl.mjs?v=1.1.2-65eb2218";
import { CONFIG } from "./config.mjs?v=1.1.2-65eb2218";
import {
  clamp,
  normalizeLocation,
  locationFromHash,
  locationHash,
} from "./flight-math.mjs?v=1.1.2-65eb2218";
import { flightCamera, VIEW_LIMITS } from "./view-math.mjs?v=1.1.2-65eb2218";
import { FlightState } from "./flight-state.mjs?v=1.1.2-65eb2218";
import { ViewControls } from "./view-controls.mjs?v=1.1.2-65eb2218";
import { SkyRenderer } from "./sky-renderer.mjs?v=1.1.2-65eb2218";
import { LightingController } from "./lighting-controller.mjs?v=1.1.2-65eb2218";
import { PlacePicker } from "./place-picker.mjs?v=1.1.2-65eb2218";
import { createNightStyle } from "./night-style.mjs?v=1.1.2-65eb2218";

const MAP_HANDLERS = [
  "dragPan",
  "dragRotate",
  "scrollZoom",
  "boxZoom",
  "keyboard",
  "doubleClickZoom",
  "touchZoomRotate",
  "touchPitch",
];
const LAMP_COLORS = {
  "night-warm": [246, 180, 93],
  "night-amber": [255, 201, 125],
  "night-white": [232, 234, 216],
};

function initialLocation() {
  const shared = locationFromHash(window.location.hash);
  if (shared) return shared;
  try {
    const saved = normalizeLocation(
      JSON.parse(localStorage.getItem("nightflight-location")),
    );
    if (saved) return saved;
  } catch {}
  return normalizeLocation(CONFIG.defaultLocation);
}
function lampImage(color) {
  const size = 16,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - 7.5, y - 7.5) / 2,
        alpha = Math.min(
          1,
          Math.exp((-distance * distance) / 1.05) +
            Math.exp((-distance * distance) / 4.5) * 0.12,
        ),
        index = (y * size + x) * 4;
      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
      data[index + 3] = Math.round(alpha * 255);
    }
  return { width: size, height: size, data };
}

class NightflightApp {
  constructor() {
    this.elements = Object.fromEntries(
      [
        "sky",
        "map",
        "notice",
        "hud",
        "choose-place",
        "place-name",
        "pause",
        "reset-view",
        "fullscreen",
        "flight-status",
      ].map((id) => [id, document.getElementById(id)]),
    );
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.flight = new FlightState(initialLocation(), {
      speed: CONFIG.speed,
      reducedMotion: this.reducedMotion,
    });
    this.map = null;
    this.ready = false;
    this.mapFailed = false;
    this.dirty = true;
    this.idle = 0;
    this.previous = performance.now();
    this.lastFrame = 0;
    this.noticeTimer = null;
    this.transientTimer = null;
    this.sky = new SkyRenderer(this.elements.sky);
    this.view = new ViewControls(this.elements.sky, {
      reducedMotion: this.reducedMotion,
      onChange: (input) => {
        if (input) this.lighting.markViewChanged(performance.now());
        this.dirty = true;
        this.wake();
      },
    });
    this.lighting = new LightingController({
      getMap: () => this.map,
      getFrame: () => this.frame(),
      isDragging: () => this.view.isDragging,
    });
    this.picker = new PlacePicker({
      maplibre,
      canvas: this.elements.sky,
      searchEndpoint: CONFIG.searchEndpoint,
      getMap: () => this.map,
      getFlight: () => this.flight,
      onChoose: (place) => this.startFlight(place),
      onHeadingChange: (heading) => {
        this.flight.setHeading(heading);
        this.saveLocation();
        this.dirty = true;
      },
      onActivity: () => this.wake(),
      onClose: () => {
        this.dirty = true;
        this.elements.sky.focus({ preventScroll: true });
      },
      onPickingChange: (picking) => {
        if (picking) this.sky.clear();
        else this.applyCamera();
        this.dirty = true;
      },
    });
    this.resize();
    this.bindEvents();
    this.updateLabel();
  }
  start() {
    this.initializeMap();
    requestAnimationFrame((now) => this.tick(now));
  }
  frame() {
    return {
      position: this.flight.position,
      heading: this.flight.heading,
      time: this.flight.time,
      bank: this.flight.bank,
      tilt: this.view.tilt,
      yaw: this.view.yaw,
      width: this.width,
      height: this.height,
    };
  }
  resize() {
    this.width = innerWidth;
    this.height = innerHeight;
    this.sky.resize(
      this.width,
      this.height,
      Math.min(devicePixelRatio || 1, CONFIG.pixelRatio),
    );
    this.map?.resize();
    this.dirty = true;
  }
  wake() {
    this.idle = 0;
    this.elements.hud.classList.remove("idle");
    this.elements["choose-place"].classList.remove("idle");
  }
  showNotice(message, error = false) {
    clearTimeout(this.transientTimer);
    const notice = this.elements.notice;
    notice.replaceChildren(document.createTextNode(message));
    if (error) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => window.location.reload());
      const offline = document.createElement("a");
      offline.href = "./offline.html?v=1.1.2-65eb2218";
      offline.textContent = "Offline flight";
      notice.append(
        document.createTextNode(" "),
        retry,
        document.createTextNode(" · "),
        offline,
      );
    }
    notice.hidden = false;
  }
  showTransient(message) {
    this.showNotice(message);
    this.transientTimer = setTimeout(() => {
      if (this.ready) this.elements.notice.hidden = true;
    }, 2600);
  }
  initializeMap() {
    maplibre.setWorkerUrl(
      new URL("./vendor/maplibre-gl-worker.mjs?v=1.1.2-65eb2218", import.meta.url).href,
    );
    maplibre.setWorkerCount(2);
    try {
      const location = this.flight.location;
      this.map = new maplibre.Map({
        container: "map",
        style: createNightStyle(CONFIG.vectorSource, CONFIG.glyphsURL),
        center: [location.lon, location.lat],
        zoom: 11,
        pitch: 66,
        bearing: this.flight.heading - 90,
        minPitch: 0,
        maxPitch: 90 - VIEW_LIMITS.minTilt,
        minZoom: 0,
        maxZoom: 18,
        attributionControl: false,
        interactive: true,
        fadeDuration: 0,
        pixelRatio: Math.min(devicePixelRatio || 1, CONFIG.pixelRatio),
        maxTileCacheSize: 100,
        renderWorldCopies: true,
        canvasContextAttributes: {
          antialias: false,
          powerPreference: "high-performance",
        },
      });
      this.map.setMissingStyleImageResolver((id) => {
        const color = LAMP_COLORS[id];
        if (color && !this.map.hasImage(id))
          this.map.addImage(id, lampImage(color), { pixelRatio: 2 });
      });
      this.map.setVerticalFieldOfView(60);
      this.map.setCenterClampedToGround(false);
      for (const handler of MAP_HANDLERS) this.map[handler]?.disable();
      this.applyCamera();
      this.map.on("sourcedata", (event) => {
        if (event.sourceId === "world" && event.sourceDataType === "content")
          this.lighting.markDataChanged(performance.now());
      });
      this.map.on("load", () => {
        this.ready = true;
        this.elements.map.dataset.state = this.mapFailed ? "error" : "ready";
        clearTimeout(this.noticeTimer);
        if (!this.mapFailed) this.elements.notice.hidden = true;
        this.dirty = true;
      });
      this.map.on("error", () => {
        if (!this.ready) {
          this.mapFailed = true;
          this.elements.map.dataset.state = "error";
          this.showNotice(
            "Map data could not load. Check your connection and retry.",
            true,
          );
        }
      });
      this.map.on("click", (event) => this.picker.pickPoint(event.lngLat));
      this.noticeTimer = setTimeout(() => {
        if (!this.ready)
          this.showNotice(
            "The map is taking a while to load. You can still choose a place.",
            true,
          );
      }, 18000);
    } catch (error) {
      this.elements.map.dataset.state = "error";
      this.showNotice("This browser could not start the world map.", true);
      console.error(error);
    }
  }
  applyCamera() {
    if (!this.map || this.picker.isPicking) return;
    const options = flightCamera({
      position: this.flight.position,
      heading: this.flight.heading,
      yaw: this.view.yaw,
      tilt: this.view.tilt,
      altitude: CONFIG.altitude,
      height: this.height,
      roll: this.flight.bank * 0.5,
    });
    if (
      [options.zoom, ...options.center, options.elevation].every(
        Number.isFinite,
      )
    )
      this.map.jumpTo(options);
  }
  updateLabel() {
    const location = this.flight.location;
    this.elements["place-name"].textContent = location.name;
    document.title = `${location.name} · Nightflight`;
    this.picker.setHeading(location.heading);
  }
  saveLocation() {
    try {
      localStorage.setItem(
        "nightflight-location",
        JSON.stringify(this.flight.location),
      );
    } catch {}
    try {
      history.replaceState(null, "", locationHash(this.flight.location));
    } catch {}
  }
  startFlight(value, preserveHeading = false) {
    const location = normalizeLocation({
      ...value,
      heading: preserveHeading ? value.heading : this.picker.heading,
    });
    if (!location) {
      document.getElementById("search-status").textContent =
        "Use a latitude between −85 and 85, and longitude between −180 and 180.";
      return;
    }
    this.flight.start(location);
    this.view.reset();
    this.sky.reset();
    this.lighting.reset(performance.now());
    this.dirty = true;
    this.picker.finishPicking();
    this.picker.close();
    this.updatePauseButton();
    this.elements["flight-status"].textContent = `Flying over ${location.name}`;
    this.updateLabel();
    this.saveLocation();
    this.applyCamera();
    this.wake();
  }
  updatePauseButton() {
    const paused = this.flight.paused;
    this.elements.pause.textContent = paused ? "▶" : "Ⅱ";
    this.elements.pause.setAttribute("aria-label", paused ? "Resume" : "Pause");
    this.elements.pause.setAttribute("aria-pressed", String(paused));
  }
  togglePause() {
    this.flight.paused = !this.flight.paused;
    this.updatePauseButton();
    this.elements["flight-status"].textContent = this.flight.paused
      ? "Paused"
      : "Cruising";
    this.dirty = true;
    this.wake();
  }
  async fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      this.showTransient("Fullscreen is unavailable in this browser.");
    }
  }
  bindEvents() {
    this.elements["choose-place"].onclick = () => this.picker.open();
    this.elements.pause.onclick = () => this.togglePause();
    this.elements["reset-view"].onclick = () => this.view.reset();
    this.elements.fullscreen.onclick = () => this.fullscreen();
    if (!document.documentElement.requestFullscreen)
      this.elements.fullscreen.hidden = true;
    document.addEventListener("fullscreenchange", () =>
      this.elements.fullscreen.setAttribute(
        "aria-label",
        document.fullscreenElement ? "Exit fullscreen" : "Fullscreen",
      ),
    );
    addEventListener("resize", () => this.resize());
    addEventListener("pointermove", () => this.wake());
    addEventListener("pointerdown", () => this.wake());
    addEventListener("keydown", (event) => this.handleKey(event));
    document.addEventListener("visibilitychange", () => {
      this.previous = performance.now();
      this.dirty = true;
    });
    addEventListener("hashchange", () => {
      const value = locationFromHash(window.location.hash);
      if (value) {
        this.picker.setHeading(value.heading);
        this.startFlight(value, true);
      }
    });
  }
  handleKey(event) {
    if (this.picker.isOpen) return;
    if (event.code === "Escape" && this.picker.isPicking) {
      this.picker.cancelPicking(false);
      return;
    }
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLButtonElement
    )
      return;
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Space",
        "Home",
      ].includes(event.code)
    )
      event.preventDefault();
    const directions = {
      ArrowUp: [0, 60],
      ArrowDown: [0, -60],
      ArrowLeft: [60, 0],
      ArrowRight: [-60, 0],
    };
    if (directions[event.code]) this.view.move(...directions[event.code]);
    if (event.repeat) return;
    if (event.code === "Space" && !this.picker.isPicking) this.togglePause();
    if (event.code === "Home") this.view.reset();
    if (event.code === "KeyL") this.picker.open();
    if (event.code === "KeyF" && document.documentElement.requestFullscreen)
      this.fullscreen();
  }
  tick(now) {
    requestAnimationFrame((next) => this.tick(next));
    if (now - this.lastFrame < 1000 / CONFIG.frameRate - 1) return;
    this.lastFrame = now;
    const dt = clamp((now - this.previous) / 1000, 0, 0.08);
    this.previous = now;
    this.idle += dt;
    const picking = this.picker.isPicking,
      modal = this.picker.isOpen,
      hidden = document.hidden;
    if (this.idle > 4 && !modal && !picking) {
      this.elements.hud.classList.add("idle");
      this.elements["choose-place"].classList.add("idle");
    }
    const moving =
      this.ready && !this.flight.paused && !modal && !picking && !hidden;
    if (moving) {
      this.flight.advance(dt);
      this.dirty = true;
    }
    if (!picking && !modal && !hidden && this.view.update(dt))
      this.dirty = true;
    this.lighting.update(now, {
      ready: this.ready,
      blocked: picking || modal || hidden,
    });
    if (picking || !this.dirty || hidden) return;
    this.dirty = false;
    this.applyCamera();
    this.sky.draw(this.frame(), moving ? dt : 0);
  }
}

const app = new NightflightApp();
app.start();
