import * as maplibre from './vendor/maplibre-gl.mjs';
import {CONFIG} from './config.mjs';
import {createNightStyle} from './night-style.mjs';
import {clamp,normalizeLocation,parseCoordinates,destination,locationFromHash,locationHash} from './flight-math.mjs';

const $=id=>document.getElementById(id),rad=Math.PI/180,TAU=Math.PI*2;
const overlay=$('sky'),ctx=overlay.getContext('2d'),dialog=$('places');
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
let location=locationFromHash(window.location.hash);
if(!location){try{location=normalizeLocation(JSON.parse(localStorage.getItem('nightflight-location')));}catch{}}
location ||= normalizeLocation(CONFIG.defaultLocation);
let position={lat:location.lat,lon:location.lon},heading=location.heading;
let time=0,paused=false,ready=false,picking=false,lookTilt=24,lookYaw=0,bank=0,dirty=true;
let width=innerWidth,height=innerHeight,pixelRatio=1,previous=performance.now(),lastFrame=0,idle=0;
let drag=null,pickMarker=null,candidate=null,searchController=null,searchBusy=false,lastSearch=-Infinity;
let map,noticeTimer,transientTimer,mapFailed=false;
const searchCache=new Map();
const random=(n,s=0)=>{let v=Math.imul(n,374761393)^Math.imul(s,668265263);v=Math.imul(v^(v>>>13),1274126177);return ((v^(v>>>16))>>>0)/4294967296;};
const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
const flightSeed=Math.floor(Math.random()*100000);
const presets=[
 {name:'Tokyo',lat:35.6812,lon:139.7671},
 {name:'New York',lat:40.7128,lon:-74.006},
 {name:'London',lat:51.5074,lon:-.1278},
 {name:'Paris',lat:48.8566,lon:2.3522},
 {name:'Hong Kong',lat:22.3027,lon:114.1772},
 {name:'São Paulo',lat:-23.5505,lon:-46.6333}
];
function showNotice(message,error=false){
 clearTimeout(transientTimer);$('notice').replaceChildren(document.createTextNode(message));
 if(error){const retry=document.createElement('button');retry.type='button';retry.textContent='Retry';retry.addEventListener('click',()=>window.location.reload());const link=document.createElement('a');link.href='./offline.html';link.textContent='Offline flight';$('notice').append(document.createTextNode(' '),retry,document.createTextNode(' · '),link);}
 $('notice').hidden=false;
}
function transient(message){showNotice(message);transientTimer=setTimeout(()=>{if(ready)$('notice').hidden=true;},2600);}
function wake(){idle=0;$('hud').classList.remove('idle');$('choose-place').classList.remove('idle');}
function resize(){width=innerWidth;height=innerHeight;pixelRatio=Math.min(devicePixelRatio||1,CONFIG.pixelRatio);overlay.width=Math.round(width*pixelRatio);overlay.height=Math.round(height*pixelRatio);ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);dirty=true;}
resize();
addEventListener('resize',()=>{resize();map?.resize();});
maplibre.setWorkerUrl(new URL('./vendor/maplibre-gl-worker.mjs',import.meta.url).href);
maplibre.setWorkerCount(2);
try{
 map=new maplibre.Map({container:'map',style:createNightStyle(CONFIG.vectorSource,CONFIG.glyphsURL),center:[location.lon,location.lat],zoom:11,pitch:66,bearing:heading-90,minPitch:0,maxPitch:145,minZoom:0,maxZoom:18,attributionControl:false,interactive:true,fadeDuration:0,pixelRatio:Math.min(devicePixelRatio||1,CONFIG.pixelRatio),maxTileCacheSize:160,renderWorldCopies:true,canvasContextAttributes:{antialias:false,powerPreference:'high-performance'}});
 map.setVerticalFieldOfView(60);
 for(const name of ['dragPan','dragRotate','scrollZoom','boxZoom','keyboard','doubleClickZoom','touchZoomRotate','touchPitch'])map[name]?.disable();
 applyCamera();
 map.on('load',()=>{ready=true;$('map').dataset.state=mapFailed?'error':'ready';clearTimeout(noticeTimer);if(!mapFailed)$('notice').hidden=true;dirty=true;});
 map.on('error',()=>{if(!ready){mapFailed=true;$('map').dataset.state='error';showNotice('Map data could not load. Check your connection and retry.',true);}});
 map.on('click',event=>{if(!picking)return;const point=normalizeLocation({lat:event.lngLat.lat,lon:((event.lngLat.lng+180)%360+360)%360-180,name:''});if(!point)return;candidate=point;if(!pickMarker){const el=document.createElement('div');el.className='pick-marker';pickMarker=new maplibre.Marker({element:el}).setLngLat([point.lon,point.lat]).addTo(map);}else pickMarker.setLngLat([point.lon,point.lat]);$('pick-instruction').textContent=`${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`;$('confirm-pick').disabled=false;});
 noticeTimer=setTimeout(()=>{if(!ready)showNotice('The map is taking a while to load. You can still choose a place.',true);},18000);
}catch(error){$('map').dataset.state='error';showNotice('This browser could not start the world map.',true);console.error(error);}

function applyCamera(){if(!map||picking)return;
 const bearing=heading-90+lookYaw,pitch=clamp(90-lookTilt,5,140);
 const options=map.calculateCameraOptionsFromCameraLngLatAltRotation([position.lon,position.lat],CONFIG.altitude,bearing,pitch,bank*.5);
 if([options.zoom,options.center.lng,options.center.lat,options.elevation].every(Number.isFinite))map.jumpTo(options);
}
function updateLabel(){ $('place-name').textContent=location.name;document.title=`${location.name} · Nightflight`;$('heading').value=String(Math.round(location.heading/45)*45%360);}
function saveLocation(){try{localStorage.setItem('nightflight-location',JSON.stringify(location));}catch{}try{history.replaceState(null,'',locationHash(location));}catch{}}
function startFlight(value,preserveHeading=false){const valid=normalizeLocation({...value,heading:preserveHeading?value.heading:Number($('heading').value)});if(!valid){$('search-status').textContent='Use a latitude between −85 and 85, and longitude between −180 and 180.';return;}
 location=valid;position={lat:valid.lat,lon:valid.lon};heading=valid.heading;time=0;bank=0;lookTilt=24;lookYaw=0;meteor=null;nextMeteor=5;paused=false;dirty=true;
 if(picking)finishPicking();if(dialog.open)dialog.close();$('pause').textContent='Ⅱ';$('pause').setAttribute('aria-label','Pause');$('pause').setAttribute('aria-pressed','false');$('flight-status').textContent=`Flying over ${valid.name}`;updateLabel();saveLocation();applyCamera();wake();
}
function openPlaces(){if(picking)return;wake();$('search-status').textContent='';$('results').replaceChildren();$('presets').hidden=false;updateLabel();dialog.showModal();setTimeout(()=>$('query').focus(),0);}
function setPaused(value){paused=value;$('pause').textContent=value?'▶':'Ⅱ';$('pause').setAttribute('aria-label',value?'Resume':'Pause');$('pause').setAttribute('aria-pressed',String(value));$('flight-status').textContent=value?'Paused':'Cruising';dirty=true;wake();}
function resetView(){lookTilt=24;lookYaw=0;dirty=true;wake();}
$('choose-place').onclick=openPlaces;$('close-places').onclick=()=>dialog.close();
dialog.addEventListener('close',()=>{searchController?.abort();dirty=true;overlay.focus({preventScroll:true});});
$('pause').onclick=()=>setPaused(!paused);$('reset-view').onclick=resetView;
for(const preset of presets){const button=document.createElement('button');button.type='button';button.textContent=preset.name;button.addEventListener('click',()=>startFlight(preset));$('presets').append(button);}
$('heading').addEventListener('change',()=>{heading=Number($('heading').value);location={...location,heading};saveLocation();dirty=true;});

async function searchPlaces(event){event.preventDefault();if(searchBusy)return;const query=$('query').value.trim();if(!query)return;
 const coordinate=parseCoordinates(query);
 if(coordinate){startFlight(coordinate);return;}
 if(/^[+\-\d.\s]+[,;][+\-\d.\s]+$/.test(query)){$('search-status').textContent='Coordinates must be latitude, longitude; latitude −85…85, longitude −180…180.';return;}
 const key=query.toLocaleLowerCase();let features=searchCache.get(key);
 if(!features){try{const saved=JSON.parse(sessionStorage.getItem('nightflight-search:'+key));if(saved&&Date.now()-saved.time<86400000&&Array.isArray(saved.features))features=saved.features;}catch{}}
 if(!features){
  if(performance.now()-lastSearch<1200){$('search-status').textContent='Please wait a moment before searching again.';return;}
  searchBusy=true;lastSearch=performance.now();$('search').disabled=true;$('search-status').textContent='Searching…';$('results').replaceChildren();
  searchController=new AbortController();const controller=searchController,timeout=setTimeout(()=>controller.abort(),12000);
  try{const url=new URL(CONFIG.searchEndpoint);url.searchParams.set('q',query);url.searchParams.set('limit','6');url.searchParams.set('lang','en');const response=await fetch(url,{signal:controller.signal,credentials:'omit'});if(!response.ok)throw new Error('Search unavailable');const data=await response.json();features=Array.isArray(data.features)?data.features:[];searchCache.set(key,features);try{sessionStorage.setItem('nightflight-search:'+key,JSON.stringify({time:Date.now(),features}));}catch{}}
  catch{if(dialog.open)$('search-status').textContent='Search is unavailable. Try coordinates or choose directly on the map.';return;}
  finally{clearTimeout(timeout);searchBusy=false;$('search').disabled=false;}
 }
 if(!dialog.open)return;renderResults(features);
}
function renderResults(features){$('results').replaceChildren();let count=0;const seen=new Set();
 for(const feature of features){const properties=feature.properties||{},coordinates=feature.geometry?.coordinates;
  if(!Array.isArray(coordinates))continue;const name=String(properties.name||properties.city||'Selected place'),detail=[properties.city,properties.state,properties.country].filter((v,i,a)=>v&&v!==name&&a.indexOf(v)===i).join(', '),place=normalizeLocation({lat:coordinates[1],lon:coordinates[0],name:detail?`${name}, ${detail}`:name});if(!place)continue;const key=(name+'|'+detail).toLocaleLowerCase();if(seen.has(key))continue;seen.add(key);
  const button=document.createElement('button');button.type='button';button.className='result';const title=document.createElement('strong'),subtitle=document.createElement('small');title.textContent=name;subtitle.textContent=detail||`${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}`;button.append(title,subtitle);button.addEventListener('click',()=>startFlight(place));$('results').append(button);count++;
 }
 $('presets').hidden=count>0;$('search-status').textContent=count?'Choose a place to begin your flight.':'No places found. Try a nearby city, coordinates, or the map.';
}
$('search-form').addEventListener('submit',searchPlaces);
$('copy-link').onclick=async()=>{const share={...location,lat:position.lat,lon:position.lon,heading};const url=new URL(window.location.href);url.hash=locationHash(share).slice(1);try{await navigator.clipboard.writeText(url.href);$('search-status').textContent='Flight link copied.';}catch{$('search-status').textContent='Copy this flight link:';const input=document.createElement('input');input.value=url.href;input.readOnly=true;$('results').replaceChildren(input);input.focus();input.select();}};

function overviewStyle(enabled){for(const id of ['overview-land','overview-borders','overview-labels'])if(map.getLayer(id))map.setLayoutProperty(id,'visibility',enabled?'visible':'none');if(map.getLayer('water'))map.setPaintProperty('water','fill-color',enabled?'#0b1928':'#010308');}
function finishPicking(){picking=false;overviewStyle(false);map.dragPan.disable();map.scrollZoom.disable();map.touchZoomRotate.disable();map.doubleClickZoom.disable();overlay.style.pointerEvents='';$('pick-controls').hidden=true;$('hud').hidden=false;$('choose-place').hidden=false;pickMarker?.remove();pickMarker=null;candidate=null;dirty=true;}
$('pick-map').onclick=()=>{if(!map)return;dialog.close();picking=true;overviewStyle(true);candidate=null;$('confirm-pick').disabled=true;$('pick-instruction').textContent='Pan and zoom, then click your starting point.';$('pick-controls').hidden=false;$('hud').hidden=true;$('choose-place').hidden=true;overlay.style.pointerEvents='none';ctx.clearRect(0,0,width,height);map.jumpTo({center:[position.lon,position.lat],zoom:3,pitch:0,roll:0,bearing:0,elevation:0});map.dragPan.enable();map.scrollZoom.enable();map.touchZoomRotate.enable();map.touchZoomRotate.disableRotation();map.doubleClickZoom.enable();};
$('cancel-pick').onclick=()=>{finishPicking();applyCamera();openPlaces();};
$('confirm-pick').onclick=()=>{if(candidate)startFlight(candidate);};

const fullscreenRoot=document.documentElement;
if(!fullscreenRoot.requestFullscreen)$('fullscreen').hidden=true;
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await fullscreenRoot.requestFullscreen();}catch{transient('Fullscreen is unavailable in this browser.');}}
$('fullscreen').onclick=fullscreen;
document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen':'Fullscreen');});
function moveLook(dx,dy){lookTilt=clamp(lookTilt-dy*.14,-48,82);lookYaw=((lookYaw-dx*.16+180)%360+360)%360-180;dirty=true;wake();}
overlay.addEventListener('pointerdown',event=>{if(!event.isPrimary||event.button!==0||drag||picking)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY};overlay.setPointerCapture(event.pointerId);overlay.classList.add('dragging');overlay.focus({preventScroll:true});wake();});
overlay.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;moveLook(event.clientX-drag.x,event.clientY-drag.y);drag.x=event.clientX;drag.y=event.clientY;});
for(const type of ['pointerup','pointercancel','lostpointercapture'])overlay.addEventListener(type,event=>{if(drag?.id===event.pointerId){drag=null;overlay.classList.remove('dragging');}});
overlay.addEventListener('dblclick',resetView);
addEventListener('keydown',event=>{if(dialog.open)return;if(event.code==='Escape'&&picking){finishPicking();applyCamera();return;}if(event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement||event.target instanceof HTMLButtonElement)return;
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Home'].includes(event.code))event.preventDefault();
 if(event.code==='ArrowUp')moveLook(0,24);if(event.code==='ArrowDown')moveLook(0,-24);if(event.code==='ArrowLeft')moveLook(24,0);if(event.code==='ArrowRight')moveLook(-24,0);
 if(!event.repeat){if(event.code==='Space'&&!picking)setPaused(!paused);if(event.code==='Home')resetView();if(event.code==='KeyL')openPlaces();if(event.code==='KeyF'&&fullscreenRoot.requestFullscreen)fullscreen();}
});
addEventListener('pointermove',wake);addEventListener('pointerdown',wake);
document.addEventListener('visibilitychange',()=>{previous=performance.now();dirty=true;});
addEventListener('hashchange',()=>{const value=locationFromHash(window.location.hash);if(value){$('heading').value=String(Math.round(value.heading/45)*45%360);startFlight(value,true);}});

// Directional sky objects use the same FOV, bearing, pitch and roll as the map.
const stars=Array.from({length:550},(_,i)=>({az:random(i,1)*TAU,elevation:Math.asin(random(i,2)),brightness:random(i,3)}));
function projectSky(az,elevation){const bearing=(heading-90+lookYaw)*rad,tilt=lookTilt*rad,ce=Math.cos(elevation),east=Math.sin(az)*ce,north=Math.cos(az)*ce,up=Math.sin(elevation),right=east*Math.cos(bearing)-north*Math.sin(bearing),forward=east*Math.sin(bearing)+north*Math.cos(bearing),depth=forward*Math.cos(tilt)-up*Math.sin(tilt);
 if(depth<=.01)return null;const focal=height/(2*Math.tan(30*rad)),x=right*focal/depth,y=(-up*Math.cos(tilt)-forward*Math.sin(tilt))*focal/depth,r=-bank*.5*rad;return {x:width/2+x*Math.cos(r)-y*Math.sin(r),y:height/2+x*Math.sin(r)+y*Math.cos(r)};
}
function glow(x,y,r,color,alpha){if(x< -10||x>width+10||y< -10||y>height+10)return;ctx.globalAlpha=alpha;ctx.fillStyle=color;ctx.shadowBlur=r*4;ctx.shadowColor=color;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();ctx.shadowBlur=0;}
let meteor=null,nextMeteor=5;
function drawSky(dt){ctx.clearRect(0,0,width,height);
 for(const star of stars){const point=projectSky(star.az,star.elevation);if(!point||point.x<0||point.x>width||point.y<0||point.y>height)continue;ctx.globalAlpha=.15+star.brightness*.4;ctx.fillStyle='#d1dce7';ctx.fillRect(point.x,point.y,star.brightness>.96?1.3:.7,star.brightness>.96?1.3:.7);}
 for(let i=0;i<3;i++){const along=22000-((time+i*71)%250)*170,out=14000+i*8000,bearing=(heading-90)*rad,east=Math.sin(bearing)*out+Math.cos(bearing)*along,north=Math.cos(bearing)*out-Math.sin(bearing)*along,point=projectSky(Math.atan2(east,north),Math.atan2(2400+i*1800,Math.hypot(east,north)));if(!point)continue;glow(point.x,point.y,.7,'#e4e3d7',.6);glow(point.x-1.2,point.y,.5,'#ef6354',.65);if((time+i*.43)%1.4<.09)glow(point.x,point.y,1.4,'#eff6ff',.9);}
 nextMeteor-=dt;if(nextMeteor<=0){meteor={az:(heading-90+lookYaw)*rad+(Math.random()-.5)*.6,elevation:clamp(-lookTilt*rad+.2+Math.random()*.3,.15,1.3),va:(Math.random()<.5?-1:1)*.35,t:0};nextMeteor=18+Math.random()*23;}
 if(meteor){meteor.t+=dt;if(meteor.t>1.05)meteor=null;else{const m=meteor,t=m.t,tail=Math.max(0,t-.14),a=projectSky(m.az+m.va*t,m.elevation-t*.22),b=projectSky(m.az+m.va*tail,m.elevation-tail*.22);if(a&&b){const gradient=ctx.createLinearGradient(b.x,b.y,a.x,a.y);gradient.addColorStop(0,'#cddfff00');gradient.addColorStop(1,'#e3efff');ctx.globalAlpha=Math.sin(t/1.05*Math.PI);ctx.strokeStyle=gradient;ctx.lineWidth=1.1;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(a.x,a.y);ctx.stroke();}}}
 ctx.globalAlpha=1;
}
function bankAt(t){if(reduced)return 0;const segment=Math.floor(t/125),local=t%125,start=18+random(segment,flightSeed)*14,duration=38+random(segment,flightSeed+1)*14;if(local<start||local>start+duration)return 0;const u=(local-start)/duration;return (random(segment,flightSeed+2)>.5?1:-1)*(4+random(segment,flightSeed+3)*3)*smooth(u/.3)*smooth((1-u)/.3);}
function tick(now){requestAnimationFrame(tick);if(now-lastFrame<1000/CONFIG.frameRate-1)return;lastFrame=now;const dt=clamp((now-previous)/1000,0,.08);previous=now;idle+=dt;
 if(idle>4&&!dialog.open&&!picking){$('hud').classList.add('idle');$('choose-place').classList.add('idle');}
 const moving=ready&&!paused&&!dialog.open&&!picking&&!document.hidden;
 if(moving){time+=dt;bank=bankAt(time);heading=(heading+Math.tan(bank*rad)*9.80665/CONFIG.speed/rad*dt+360)%360;if(position.lat>84.5)heading=180;if(position.lat< -84.5)heading=0;position=destination(position,heading,CONFIG.speed*dt);dirty=true;}
 if(picking||!dirty||document.hidden)return;dirty=false;applyCamera();drawSky(moving?dt:0);
}
updateLabel();requestAnimationFrame(tick);
