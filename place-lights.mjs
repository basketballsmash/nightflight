// Cached artistic light points inside real mapped neighborhoods/buildings.
// No tile downloads, per-frame geometry processing, or geocoding happens here.
const R=6378137,rad=Math.PI/180;
const mercator=([lon,lat])=>[R*lon*rad,R*Math.log(Math.tan(Math.PI/4+Math.max(-85,Math.min(85,lat))*rad/2))];
const lngLat=([x,y])=>[x/R/rad,(2*Math.atan(Math.exp(y/R))-Math.PI/2)/rad];
const hash=(x,y,salt=0)=>{let n=Math.imul(x|0,73856093)^Math.imul(y|0,19349663)^salt;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;};
export function insideRing(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
export function insidePolygon(point,rings){return rings.length>0&&insideRing(point,rings[0])&&!rings.slice(1).some(ring=>insideRing(point,ring));}
export function createPlaceLights(features,{center,maxPoints=4500}={}){
 const focus=mercator(center||[0,0]),limit=65000/Math.max(.12,Math.cos((center?.[1]||0)*rad)),polygons=[];
 for(const feature of features){const geometry=feature.geometry;if(!geometry)continue;const groups=geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
  for(const group of groups){if(!group?.[0]?.length)continue;const rings=group.map(ring=>ring.map(mercator)),outer=rings[0];let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const [x,y]of outer){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}const x=(minX+maxX)/2,y=(minY+maxY)/2,dist=Math.hypot(((x-focus[0]+2*Math.PI*R*1.5)%(2*Math.PI*R))-Math.PI*R,y-focus[1]);if(dist>limit+Math.hypot(maxX-minX,maxY-minY)/2)continue;polygons.push({rings,minX,minY,maxX,maxY,dist,kind:feature.properties?.class||'building',building:feature.sourceLayer==='building'||feature.properties?.lightBuilding===true});}
 }
 polygons.sort((a,b)=>Number(b.building)-Number(a.building)||a.dist-b.dist);
 const seen=new Set(),points=[];
 function add(point,polygon,grid){const key='b:'+Math.floor(point[0]/160)+':'+Math.floor(point[1]/160);if(seen.has(key))return;seen.add(key);const x=Math.floor(point[0]/160),y=Math.floor(point[1]/160),r=hash(x,y,107),commercial=hash(x,y,211)>.7,shade=hash(x,y,173);if(r<.13)return;
  const color=shade>.94?'#a9c4e1':shade>(commercial?.69:.87)?'#e7ebdd':shade>.58?'#ffe3aa':shade>.2?'#f4b65c':'#df893d';
  points.push({type:'Feature',id:key,geometry:{type:'Point',coordinates:lngLat(point)},properties:{kind:'building',color,radius:(.55+hash(x,y,31)*.7)*(commercial?1.15:1),opacity:.32+hash(x,y,53)*.58}});
 }
 for(const polygon of polygons){if(points.length>=maxPoints)break;const {minX,minY,maxX,maxY,rings}=polygon,grid=160;
  if(polygon.building){const gx=Math.floor((minX+maxX)/320),gy=Math.floor((minY+maxY)/320),point=[(gx+.18+hash(gx,gy,1)*.64)*grid,(gy+.18+hash(gx,gy,2)*.64)*grid];if(insidePolygon(point,rings))add(point,polygon,grid);continue;}
  const columns=Math.ceil((maxX-minX)/grid),rows=Math.ceil((maxY-minY)/grid),stride=Math.max(1,Math.ceil(Math.sqrt(columns*rows/260))),startX=Math.ceil(minX/grid),startY=Math.ceil(minY/grid);
  for(let row=0;row<=rows;row+=stride)for(let col=0;col<=columns;col+=stride){if(points.length>=maxPoints)break;const gx=startX+col,gy=startY+row,point=[(gx+.18+hash(gx,gy,1)*.64)*grid,(gy+.18+hash(gx,gy,2)*.64)*grid];if(point[0]>maxX||point[1]>maxY||!insidePolygon(point,rings))continue;add(point,polygon,grid);}
 }
 return {type:'FeatureCollection',features:points};
}
