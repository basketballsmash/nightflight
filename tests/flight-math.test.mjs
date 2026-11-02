import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLocation,parseCoordinates,destination,locationFromHash,locationHash} from '../flight-math.mjs';

test('coordinates use latitude, longitude, including decimals and negative values',()=>{
 assert.deepEqual(parseCoordinates(' 35.6812, 139.7671 '),{lat:35.6812,lon:139.7671,heading:90,name:'35.6812, 139.7671'});
 assert.equal(parseCoordinates('-23.5505; -46.6333').lat,-23.5505);
 assert.equal(parseCoordinates('.5, -.25').lon,-.25);
});
test('malformed, non-finite, and out-of-map coordinates are rejected',()=>{
 for(const text of ['Tokyo','91, 0','85.1, 0','0, 181','NaN, 2','1, Infinity','1,2,3','<img>, 2'])assert.equal(parseCoordinates(text),null,text);
 for(const value of [null,{}, {lat:'',lon:1},{lat:null,lon:1},{lat:Infinity,lon:1},{lat:1,lon:NaN},{lat:1,lon:2,heading:Infinity}])assert.equal(normalizeLocation(value),null);
});
test('locations support the map boundaries and normalize bearings',()=>{
 assert.equal(normalizeLocation({lat:85,lon:180,heading:-90}).heading,270);
 assert.equal(normalizeLocation({lat:-85,lon:-180,heading:450}).heading,90);
});
test('share links preserve international place names and valid coordinates',()=>{
 const location={lat:35.6812,lon:139.7671,heading:90,name:'東京 / Tokyo & Chiyoda'};
 assert.deepEqual(locationFromHash(locationHash(location)),location);
 assert.equal(locationFromHash('#lat=NaN&lon=5'),null);
 assert.equal(locationFromHash('#lat=1'),null);
 assert.equal(locationFromHash('#lat=&lon=1'),null);
 assert.throws(()=>locationHash({lat:100,lon:0}));
});
test('eastbound flight crosses the date line without invalid longitudes',()=>{
 const position=destination({lat:0,lon:179.99},90,5000);
 assert.ok(position.lon< -179.9&&position.lon>=-180);
 assert.ok(Math.abs(position.lat)<1e-9);
});
test('a 235 m step moves the aircraft the correct geographic distance',()=>{
 const origin={lat:51.5074,lon:-.1278},next=destination(origin,63,235),rad=Math.PI/180;
 const dLat=(next.lat-origin.lat)*rad,dLon=(next.lon-origin.lon)*rad;
 const a=Math.sin(dLat/2)**2+Math.cos(origin.lat*rad)*Math.cos(next.lat*rad)*Math.sin(dLon/2)**2;
 assert.ok(Math.abs(6371008.8*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))-235)<1e-6);
});
test('stationary and high-latitude flight remain finite',()=>{
 const start={lat:-33.8688,lon:151.2093},same=destination(start,0,0);
 assert.ok(Math.abs(same.lat-start.lat)<1e-10&&Math.abs(same.lon-start.lon)<1e-10);
 const polar=destination({lat:84.5,lon:179.9},90,50000);
 assert.ok(Number.isFinite(polar.lat)&&Number.isFinite(polar.lon));
});
