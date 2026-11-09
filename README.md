# Nightflight

An endless night flight over **real places**, with glowing streets, a draggable view, stars, and occasional aircraft and meteors. Based on Night Freeway's points-of-light concept.

## Choose a place

Click the place name at the top left (or press **L**). You can:

- Search for a city, neighborhood, landmark, or address, then choose a result.
- Enter **latitude, longitude**, such as `35.6812, 139.7671`.
- Choose on the map: pan/zoom, click a starting point, then select **Fly here**.
- Try a preset, choose a flight direction, or copy a link to the current location.

The aircraft cruises at 9,000 metres and 235 m/s, with gentle occasional banks. Movement follows geographic coordinates and handles the international date line. The map covers latitudes **85° south to 85° north**. Oceans, deserts, and other places without mapped streets will naturally have few lights.

The geography is actual OpenStreetMap roads, buildings, rivers, parks, and coastlines. Roads render as separated world-anchored light points rather than continuous strokes. Building/neighborhood lights use stable mixes of warm amber, soft yellow, white, and occasional cool light, with varied sizes and brightness; generated neighborhood points stay inside mapped urban polygons and out of polygon holes. The night lighting is an artistic style, not live satellite imagery, measured illumination, real-time weather, or live aircraft tracking. Terrain is flat; elevation is not simulated.

## Controls

| Control | Action |
| --- | --- |
| Mouse or one-finger drag | Look up, down, or sideways |
| Arrow keys | Adjust the view |
| Home or double-click | Reset the view |
| Space | Pause / resume |
| L | Choose a place |
| F | Fullscreen |

Dragging uses reduced sensitivity and a short, non-overshooting ease, with safe upward/downward limits. Camera transforms are computed from the aircraft position without inheriting elevation from previous views. The view stays interactive while paused. Flight pauses while the place picker is open. Reduced-motion preferences disable automatic banking. The controls fade while idle; source attribution remains visible.

## GitHub Pages

This is still a **static website**. No server application, secret API keys, installation, or build step is needed on GitHub Pages.

1. Push **all files**, including `vendor/`, to your GitHub repository.
2. Open **Settings → Pages → Deploy from a branch**.
3. Select the publishing branch and **/(root)**, then save.

All local paths are relative, so both `username.github.io/` and `username.github.io/repository/` work. `.nojekyll` keeps deployment as plain static files.

The bottom-right label shows the release, a content-based build ID, and whether you are in world or offline mode. Before publishing a new release, run:

```
node scripts/release.mjs 1.1.1
```

Use the next version number. This updates both labels, all local asset cache keys (files in `vendor/` are keyed by their own content, so they stay cached across app releases), and the Content-Security-Policy hashes for the inline `<script>`/`<style>` blocks; commit and push the resulting files together. `node scripts/release.mjs --check` verifies that the stamp matches the source. Running the script without a version refreshes the content-based build ID for the current release. No build command is needed on GitHub Pages because these stamped files are checked in.

Both pages declare a Content-Security-Policy `<meta>` tag. If you point `config.mjs` at different tile, glyph, or search providers, add their origins to `connect-src` in `index.html`.

GitHub Pages serves the pushed branch, not uncommitted local edits. Check the repository’s Actions tab for a successful Pages deployment. If the deployment is current but the browser looks old, use Ctrl+Shift+R (Cmd+Shift+R on macOS); the Pages cache can retain responses for about 10 minutes. Versioned module/CSS URLs prevent stale assets being mixed with a fresh page.

For local preview, serve this directory over HTTP, for example `npx --yes serve .`. Opening the world-flight page directly with `file://` is not supported because browsers restrict JavaScript modules and workers. `offline.html` is the original self-contained procedural version and can be opened directly.

## Data and dependencies

- [MapLibre GL JS 6.16.0](https://maplibre.org/): pinned, vendored locally with its BSD-3-Clause license in `vendor/MAPLIBRE-LICENSE.txt`.
- [OpenFreeMap](https://openfreemap.org/quick_start/): public vector tiles and map-picker label glyphs, built from OpenStreetMap/OpenMapTiles. Map attribution stays visible.
- [Photon](https://github.com/komoot/photon): public place search. Queries are sent only when Search is pressed; no autocomplete or background geocoding. Results are cached for the session and requests are limited to one per 1.2 seconds. The public service has reasonable-use limits and no availability guarantee; use your own Photon instance for high traffic.

World flights require an internet connection for map data and search. Coordinate entry and map picking do not depend on the search service. If map loading fails, an error links to the offline flight. Service URLs and flight/performance settings are editable in `config.mjs`.

Rendering uses MapLibre's GPU tile batching, a 30 fps animation cap, 1.25 maximum pixel density, two map workers plus a dedicated lighting worker, and a bounded tile cache. Road/building light points are capped at 12,000. Raw tile geometry is collected in short, yielding batches, transferred to the lighting worker, and refreshed at most every three seconds during normal flight, with a faster refresh after a view change settles. Stable world-coordinate keys and cached points prevent reshuffling; coarser duplicate roads are removed when detailed tiles arrive. Light radii stay consistent while tilting. The per-tile adapter targets the pinned MapLibre 6.16.0 renderer, with a public-API fallback for future upgrades. The sky overlay is separate and has no moon, cloud, rain, or fog effects. Meteor heads/tails stay above the horizon and the entire overlay is clipped to the visible sky, including during banking.

## Code structure

`nightflight.mjs` coordinates the app and animation loop. `flight-state.mjs` owns movement and banking, `view-controls.mjs` handles dragging, and `sky-renderer.mjs` draws the sky overlay. `place-picker.mjs` owns the place UI; `place-search.mjs` handles search, caching, and throttling.

`lighting-controller.mjs` schedules updates, `map-lighting-source.mjs` isolates the pinned MapLibre tile adapter, and `lights-worker.mjs` owns the per-flight light cache. Pure geometry calculations live in `light-geometry.mjs`, `place-lights.mjs`, `flight-math.mjs`, and `view-math.mjs`. Modules are served directly; no bundler is required.

## Validation

Run the coordinate, share-link, geographic-motion, light-placement, camera-stability, and meteor/horizon tests with:

```
node --test
```

Browser checks cover live map loading and search, coordinate entry, map picking, share links, mouse/touch view controls, pause, mobile layout, offline errors, and deployment under a project subdirectory.

## Acknowledgements

Adapted from Night Freeway by Masayuki Hatta. The original project was inspired by the FreeWay recreation at soyokaze2000.com, FKS's original FreeWay, and Yoshihiro Sugahara's Windows port. Original project code is MIT licensed; see LICENSE. MapLibre retains its separate bundled license, and map data is credited to its providers.
