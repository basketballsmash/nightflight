import {
  normalizeLocation,
  parseCoordinates,
  locationHash,
} from "./flight-math.mjs?v=1.1.3-7f057a33";
import {
  PlaceSearch,
  SearchThrottleError,
  searchResults,
} from "./place-search.mjs?v=1.1.3-7f057a33";

const PRESETS = [
  { name: "Tokyo", lat: 35.6812, lon: 139.7671 },
  { name: "New York", lat: 40.7128, lon: -74.006 },
  { name: "London", lat: 51.5074, lon: -0.1278 },
  { name: "Paris", lat: 48.8566, lon: 2.3522 },
  { name: "Hong Kong", lat: 22.3027, lon: 114.1772 },
  { name: "São Paulo", lat: -23.5505, lon: -46.6333 },
];
const OVERVIEW_LAYERS = [
  "overview-land",
  "overview-borders",
  "overview-labels",
];
const FLIGHT_LIGHT_LAYERS = [
  "building-lamps",
  "building-halos",
  "arterial-lamps",
  "road-halos",
];

export class PlacePicker {
  constructor({
    maplibre,
    canvas,
    searchEndpoint,
    getMap,
    getFlight,
    onChoose,
    onHeadingChange,
    onActivity,
    onClose,
    onPickingChange,
  }) {
    Object.assign(this, {
      maplibre,
      canvas,
      getMap,
      getFlight,
      onChoose,
      onHeadingChange,
      onActivity,
      onClose,
      onPickingChange,
    });
    this.elements = Object.fromEntries(
      [
        "places",
        "query",
        "search-form",
        "search",
        "search-status",
        "results",
        "presets",
        "heading",
        "pick-controls",
        "confirm-pick",
        "pick-instruction",
        "hud",
        "choose-place",
      ].map((id) => [id, document.getElementById(id)]),
    );
    this.dialog = this.elements.places;
    this.searchService = new PlaceSearch(searchEndpoint);
    this.isPicking = false;
    this.candidate = null;
    this.marker = null;
    this.bindEvents();
    this.renderPresets();
  }
  get isOpen() {
    return this.dialog.open;
  }
  get heading() {
    return Number(this.elements.heading.value);
  }
  setHeading(heading) {
    this.elements.heading.value = String((Math.round(heading / 45) * 45) % 360);
  }
  bindEvents() {
    document.getElementById("close-places").onclick = () => this.dialog.close();
    this.dialog.addEventListener("close", () => {
      this.searchService.abort();
      this.onClose();
    });
    this.elements["search-form"].addEventListener("submit", (event) =>
      this.search(event),
    );
    this.elements.heading.addEventListener("change", () =>
      this.onHeadingChange(this.heading),
    );
    document.getElementById("copy-link").onclick = () => this.copyLink();
    document.getElementById("pick-map").onclick = () => this.beginPicking();
    document.getElementById("cancel-pick").onclick = () => this.cancelPicking();
    this.elements["confirm-pick"].onclick = () => {
      if (this.candidate) this.onChoose(this.candidate);
    };
  }
  renderPresets() {
    for (const preset of PRESETS) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = preset.name;
      button.addEventListener("click", () => this.onChoose(preset));
      this.elements.presets.append(button);
    }
  }
  open() {
    if (this.isPicking) return;
    this.onActivity();
    this.elements["search-status"].textContent = "";
    this.elements.results.replaceChildren();
    this.elements.presets.hidden = false;
    this.setHeading(this.getFlight().location.heading);
    this.dialog.showModal();
    setTimeout(() => this.elements.query.focus(), 0);
  }
  close() {
    if (this.dialog.open) this.dialog.close();
  }
  async search(event) {
    event.preventDefault();
    if (this.searchService.busy) return;
    const query = this.elements.query.value.trim();
    if (!query) return;
    const coordinate = parseCoordinates(query);
    if (coordinate) {
      this.onChoose(coordinate);
      return;
    }
    if (/^[+\-\d.\s]+[,;][+\-\d.\s]+$/.test(query)) {
      this.elements["search-status"].textContent =
        "Coordinates must be latitude, longitude; latitude −85…85, longitude −180…180.";
      return;
    }
    this.elements.search.disabled = true;
    this.elements["search-status"].textContent = "Searching…";
    this.elements.results.replaceChildren();
    try {
      const features = await this.searchService.search(query);
      if (this.isOpen) this.renderResults(features);
    } catch (error) {
      if (this.isOpen)
        this.elements["search-status"].textContent =
          error instanceof SearchThrottleError
            ? error.message
            : "Search is unavailable. Try coordinates or choose directly on the map.";
    } finally {
      this.elements.search.disabled = false;
    }
  }
  renderResults(features) {
    this.elements.results.replaceChildren();
    const results = searchResults(features);
    for (const { name, detail, place } of results) {
      const button = document.createElement("button"),
        title = document.createElement("strong"),
        subtitle = document.createElement("small");
      button.type = "button";
      button.className = "result";
      title.textContent = name;
      subtitle.textContent = detail;
      button.append(title, subtitle);
      button.addEventListener("click", () => this.onChoose(place));
      this.elements.results.append(button);
    }
    this.elements.presets.hidden = results.length > 0;
    this.elements["search-status"].textContent = results.length
      ? "Choose a place to begin your flight."
      : "No places found. Try a nearby city, coordinates, or the map.";
  }
  async copyLink() {
    const flight = this.getFlight(),
      share = {
        ...flight.location,
        ...flight.position,
        heading: flight.heading,
      },
      url = new URL(window.location.href);
    url.hash = locationHash(share).slice(1);
    try {
      await navigator.clipboard.writeText(url.href);
      this.elements["search-status"].textContent = "Flight link copied.";
    } catch {
      this.elements["search-status"].textContent = "Copy this flight link:";
      const input = document.createElement("input");
      input.value = url.href;
      input.readOnly = true;
      this.elements.results.replaceChildren(input);
      input.focus();
      input.select();
    }
  }
  setOverview(enabled) {
    const map = this.getMap();
    for (const id of OVERVIEW_LAYERS)
      if (map.getLayer(id))
        map.setLayoutProperty(id, "visibility", enabled ? "visible" : "none");
    for (const id of FLIGHT_LIGHT_LAYERS)
      if (map.getLayer(id))
        map.setLayoutProperty(id, "visibility", enabled ? "none" : "visible");
    if (map.getLayer("water"))
      map.setPaintProperty(
        "water",
        "fill-color",
        enabled ? "#0b1928" : "#010308",
      );
  }
  beginPicking() {
    const map = this.getMap();
    if (!map) return;
    this.close();
    this.isPicking = true;
    this.setOverview(true);
    this.candidate = null;
    this.elements["confirm-pick"].disabled = true;
    this.elements["pick-instruction"].textContent =
      "Pan and zoom, then click your starting point.";
    this.elements["pick-controls"].hidden = false;
    this.elements.hud.hidden = true;
    this.elements["choose-place"].hidden = true;
    this.canvas.style.pointerEvents = "none";
    this.onPickingChange(true);
    const position = this.getFlight().position;
    map.jumpTo({
      center: [position.lon, position.lat],
      zoom: 3,
      pitch: 0,
      roll: 0,
      bearing: 0,
      elevation: 0,
    });
    map.dragPan.enable();
    map.scrollZoom.enable();
    map.touchZoomRotate.enable();
    map.touchZoomRotate.disableRotation();
    map.doubleClickZoom.enable();
  }
  pickPoint(lngLat) {
    if (!this.isPicking) return;
    const point = normalizeLocation({
      lat: lngLat.lat,
      lon: ((((lngLat.lng + 180) % 360) + 360) % 360) - 180,
      name: "",
    });
    if (!point) return;
    this.candidate = point;
    if (!this.marker) {
      const element = document.createElement("div");
      element.className = "pick-marker";
      this.marker = new this.maplibre.Marker({ element })
        .setLngLat([point.lon, point.lat])
        .addTo(this.getMap());
    } else this.marker.setLngLat([point.lon, point.lat]);
    this.elements["pick-instruction"].textContent =
      `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`;
    this.elements["confirm-pick"].disabled = false;
  }
  finishPicking() {
    if (!this.isPicking) return;
    const map = this.getMap();
    this.isPicking = false;
    this.setOverview(false);
    map.dragPan.disable();
    map.scrollZoom.disable();
    map.touchZoomRotate.disable();
    map.doubleClickZoom.disable();
    this.canvas.style.pointerEvents = "";
    this.elements["pick-controls"].hidden = true;
    this.elements.hud.hidden = false;
    this.elements["choose-place"].hidden = false;
    this.marker?.remove();
    this.marker = null;
    this.candidate = null;
    this.onPickingChange(false);
  }
  cancelPicking(openDialog = true) {
    this.finishPicking();
    if (openDialog) this.open();
  }
}
