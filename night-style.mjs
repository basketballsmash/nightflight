// Actual OpenStreetMap geometries with a restrained, label-free emissive style.
export function createNightStyle(sourceURL,glyphsURL){
 return {version:8,name:'Nightflight — real streets',glyphs:glyphsURL,sources:{world:{type:'vector',url:sourceURL},'place-lights':{type:'geojson',data:{type:'FeatureCollection',features:[]},maxzoom:14,buffer:16}},
  sky:{'sky-color':'#020306','horizon-color':'#020306','sky-horizon-blend':0,'fog-color':'#020306','fog-ground-blend':0,'horizon-fog-blend':0,'atmosphere-blend':0},
  layers:[
   {id:'night',type:'background',paint:{'background-color':'#020306'}},
   {id:'overview-land',type:'background',layout:{visibility:'none'},paint:{'background-color':'#26303a'}},
   {id:'neighborhoods',type:'fill',source:'world','source-layer':'landuse',filter:['in',['get','class'],['literal',['residential','commercial','retail','industrial']]],paint:{'fill-color':['match',['get','class'],'commercial','#6a4623','retail','#775632','#362516'],'fill-opacity':.015}},
   {id:'parks',type:'fill',source:'world','source-layer':'landcover',filter:['in',['get','class'],['literal',['wood','grass','farmland']]],paint:{'fill-color':'#020507','fill-opacity':.7}},
   {id:'parkland',type:'fill',source:'world','source-layer':'park',paint:{'fill-color':'#020507','fill-opacity':.8}},
   {id:'water',type:'fill',source:'world','source-layer':'water',paint:{'fill-color':'#010308'}},
   {id:'rivers',type:'line',source:'world','source-layer':'waterway',minzoom:8,paint:{'line-color':'#010308','line-width':['interpolate',['linear'],['zoom'],8,.4,13,2,16,7]}},
   {id:'building-halos',type:'circle',source:'place-lights',filter:['==',['get','kind'],'building'],paint:{'circle-pitch-scale':'viewport','circle-pitch-alignment':'viewport','circle-color':['get','color'],'circle-radius':['*',['get','radius'],3.4],'circle-blur':1,'circle-opacity':['*',['get','opacity'],.18]}},
   {id:'building-lamps',type:'circle',source:'place-lights',filter:['==',['get','kind'],'building'],paint:{'circle-pitch-scale':'viewport','circle-pitch-alignment':'viewport','circle-color':['get','color'],'circle-radius':['get','radius'],'circle-blur':.18,'circle-opacity':['get','opacity']}},
   {id:'road-halos',type:'circle',source:'place-lights',filter:['==',['get','kind'],'road'],paint:{'circle-pitch-scale':'viewport','circle-pitch-alignment':'viewport','circle-color':['get','color'],'circle-radius':['*',['get','radius'],2.8],'circle-blur':1,'circle-opacity':['*',['get','opacity'],.13]}},
   {id:'arterial-lamps',type:'circle',source:'place-lights',filter:['==',['get','kind'],'road'],paint:{'circle-pitch-scale':'viewport','circle-pitch-alignment':'viewport','circle-color':['get','color'],'circle-radius':['get','radius'],'circle-blur':.15,'circle-opacity':['get','opacity']}},
   {id:'overview-borders',type:'line',source:'world','source-layer':'boundary',layout:{visibility:'none'},paint:{'line-color':'#8b9da5','line-opacity':.4,'line-width':.6}},
   {id:'overview-labels',type:'symbol',source:'world','source-layer':'place',layout:{visibility:'none','text-field':['coalesce',['get','name:en'],['get','name_en'],['get','name:latin'],['get','name']],'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],0,10,6,12,12,14],'text-max-width':12,'symbol-sort-key':['coalesce',['get','rank'],100]},paint:{'text-color':'#dbe4e5','text-halo-color':'#1b2630','text-halo-width':1.5}},
   {id:'runways',type:'symbol',source:'world','source-layer':'aeroway',minzoom:10,filter:['==',['geometry-type'],'LineString'],layout:{'symbol-placement':'line','symbol-spacing':13,'icon-image':'night-white','icon-size':.7,'icon-allow-overlap':true,'icon-ignore-placement':true,'icon-pitch-alignment':'viewport','icon-rotation-alignment':'viewport'},paint:{'icon-opacity':.7}}
  ]};
}
