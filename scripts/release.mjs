// Update checked-in version labels and cache keys; GitHub Pages needs no build step.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (file) =>
  readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const metadata = JSON.parse(read("version.json"));
const check = process.argv.includes("--check");
const requested = process.argv.slice(2).find((arg) => arg !== "--check");
const version = requested || metadata.version;
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))
  throw new Error("Use a version such as 1.1.1");
const files = [
  "index.html",
  "offline.html",
  "nightflight.css",
  "nightflight.mjs",
  "night-style.mjs",
  "flight-math.mjs",
  "place-lights.mjs",
  "view-math.mjs",
  "lights-worker.mjs",
  "config.mjs",
  "flight-state.mjs",
  "view-controls.mjs",
  "sky-renderer.mjs",
  "place-picker.mjs",
  "place-search.mjs",
  "lighting-controller.mjs",
  "map-lighting-source.mjs",
  "light-geometry.mjs",
  "night-lights-layer.mjs",
];
const asset = /(\.\/[^"'\s<>]+\.(?:mjs|js|css|html))(?:\?v=[^"'\s<>]*)?/g;
const label = /(<div\s+id="build-version"[^>]*>)[^<]*(<\/div>)/;
// Inline <script>/<style> blocks are allowed by hash, so the CSP must be
// re-stamped whenever their text (including versioned URLs) changes.
const csp = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/;
const inlineSources = { "script-src": "script", "style-src": "style" };
function inlineHashes(tag, text) {
  return [...text.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map(
    (match) =>
      `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`,
  );
}
function stampCsp(text, hashes = true) {
  return text.replace(csp, (_, open, policy, close) => {
    const directives = policy
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/),
          kept = sources.filter((source) => !source.startsWith("'sha256-"));
        if (!inlineSources[name]) return directive;
        const added = hashes ? inlineHashes(inlineSources[name], text) : [];
        return [name, ...kept, ...added].join(" ");
      });
    return open + directives.join("; ") + close;
  });
}
function canonical(text) {
  return stampCsp(
    text.replace(asset, "$1").replace(label, "$1__BUILD__$2"),
    false,
  );
}
const content = new Map(files.map((file) => [file, canonical(read(file))]));
const hash = createHash("sha256").update(version + "\n");
for (const [file, text] of content) hash.update(file + "\n" + text + "\n");
for (const file of ["vendor/maplibre-gl.mjs", "vendor/maplibre-gl-worker.mjs"])
  hash.update(file + "\n" + read(file));
const build = hash.digest("hex").slice(0, 8),
  token = `${version}-${build}`;
// Vendored files change only when MapLibre is upgraded, so they get their own
// content hash: an app release must not evict ~440 KB of cached MapLibre.
const vendorTokens = new Map();
function assetToken(url) {
  if (!url.startsWith("./vendor/")) return token;
  if (!vendorTokens.has(url))
    vendorTokens.set(
      url,
      createHash("sha256").update(read(url.slice(2))).digest("hex").slice(0, 8),
    );
  return vendorTokens.get(url);
}
let stale = false;
for (const [file, text] of content) {
  const mode = file === "offline.html" ? "offline" : "world";
  const output = stampCsp(
    text
      .replace(asset, (_, url) => `${url}?v=${assetToken(url)}`)
      .replace(label, `$1v${version} · ${build} · ${mode}$2`),
  );
  if (output !== read(file)) {
    stale = true;
    if (!check) writeFileSync(path.join(root, file), output);
  }
}
const output = JSON.stringify({ version, build }, null, 2) + "\n";
if (read("version.json") !== output) {
  stale = true;
  if (!check) writeFileSync(path.join(root, "version.json"), output);
}
if (check && stale) {
  console.error(
    "Version stamp is stale. Run node scripts/release.mjs before publishing.",
  );
  process.exitCode = 1;
} else
  console.log(
    `${check ? "Verified" : "Stamped"} Nightflight v${version} · ${build}`,
  );
