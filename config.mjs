// Public, keyless services. Change these URLs to use your own providers.
export const CONFIG = Object.freeze({
  vectorSource: 'https://tiles.openfreemap.org/planet',
  glyphsURL: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  searchEndpoint: 'https://photon.komoot.io/api/',
  altitude: 9000,
  speed: 235,
  frameRate: 30,
  pixelRatio: 1.25,
  defaultLocation: {lat:35.6812, lon:139.7671, heading:90, name:'Tokyo, Japan'}
});
