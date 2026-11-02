export const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export const wrapLongitude=lon=>((lon+180)%360+360)%360-180;
export function normalizeLocation(value){
 if(!value||value.lat==null||value.lon==null||String(value.lat).trim()===''||String(value.lon).trim()==='')return null;
 const lat=Number(value.lat),lon=Number(value.lon),heading=Number(value.heading??90);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||!Number.isFinite(heading)||Math.abs(lat)>85||Math.abs(lon)>180)return null;
 return {lat,lon,heading:((heading%360)+360)%360,name:String(value.name||`${lat.toFixed(4)}, ${lon.toFixed(4)}`).slice(0,160)};
}
export function parseCoordinates(text){
 const match=text.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[,;]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);
 return match?normalizeLocation({lat:match[1],lon:match[2]}):null;
}
export function destination(position,bearing,metres){
 const rad=Math.PI/180,angular=metres/6371008.8,phi=position.lat*rad,lambda=position.lon*rad,theta=bearing*rad;
 const phi2=Math.asin(clamp(Math.sin(phi)*Math.cos(angular)+Math.cos(phi)*Math.sin(angular)*Math.cos(theta),-1,1));
 const lambda2=lambda+Math.atan2(Math.sin(theta)*Math.sin(angular)*Math.cos(phi),Math.cos(angular)-Math.sin(phi)*Math.sin(phi2));
 return {lat:phi2/rad,lon:wrapLongitude(lambda2/rad)};
}
export function locationFromHash(hash){
 const params=new URLSearchParams(hash.replace(/^#/,''));
 if(!params.has('lat')||!params.has('lon'))return null;
 return normalizeLocation({lat:params.get('lat'),lon:params.get('lon'),heading:params.get('heading')??90,name:params.get('name')||''});
}
export function locationHash(location){
 const valid=normalizeLocation(location);if(!valid)throw new Error('Invalid flight location');
 return '#'+new URLSearchParams({lat:valid.lat.toFixed(6),lon:valid.lon.toFixed(6),heading:String(Math.round(valid.heading)),name:valid.name}).toString();
}
