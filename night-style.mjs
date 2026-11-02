// Actual OpenStreetMap geometries with a restrained, label-free emissive style.
export function createNightStyle(sourceURL,glyphsURL){
 const roadClasses=['motorway','trunk','primary','secondary','tertiary','minor','service'];
 const roads=['all',['==',['geometry-type'],'LineString'],['in',['get','class'],['literal',roadClasses]],['!=',['get','brunnel'],'tunnel']];
 const major=['all',...roads.slice(1),['in',['get','class'],['literal',['motorway','trunk','primary','secondary']]]];
 const local=['all',...roads.slice(1),['in',['get','class'],['literal',['tertiary','minor','service']]]];
 const color=['match',['get','class'],'motorway','#f2ddaa','trunk','#ffce76','primary','#ffbd61','secondary','#edaa55','#c78b45'];
 return {version:8,name:'Nightflight — real streets',glyphs:glyphsURL,sources:{world:{type:'vector',url:sourceURL}},
  sky:{'sky-color':'#020306','horizon-color':'#020306','sky-horizon-blend':0,'fog-color':'#020306','fog-ground-blend':0,'horizon-fog-blend':0,'atmosphere-blend':0},
  layers:[
   {id:'night',type:'background',paint:{'background-color':'#020306'}},
   {id:'overview-land',type:'background',layout:{visibility:'none'},paint:{'background-color':'#26303a'}},
   {id:'neighborhoods',type:'fill',source:'world','source-layer':'landuse',filter:['in',['get','class'],['literal',['residential','commercial','retail','industrial']]],paint:{'fill-color':['match',['get','class'],'commercial','#6a4623','retail','#775632','#362516'],'fill-opacity':['interpolate',['linear'],['zoom'],7,.05,11,.15,15,.24]}},
   {id:'parks',type:'fill',source:'world','source-layer':'landcover',filter:['in',['get','class'],['literal',['wood','grass','farmland']]],paint:{'fill-color':'#020507','fill-opacity':.7}},
   {id:'parkland',type:'fill',source:'world','source-layer':'park',paint:{'fill-color':'#020507','fill-opacity':.8}},
   {id:'water',type:'fill',source:'world','source-layer':'water',paint:{'fill-color':'#010308'}},
   {id:'rivers',type:'line',source:'world','source-layer':'waterway',minzoom:8,paint:{'line-color':'#010308','line-width':['interpolate',['linear'],['zoom'],8,.4,13,2,16,7]}},
   {id:'buildings',type:'fill',source:'world','source-layer':'building',minzoom:12,paint:{'fill-color':'#b58b54','fill-opacity':['interpolate',['linear'],['zoom'],12,.09,14,.28,17,.4]}},
   {id:'local-glow',type:'line',source:'world','source-layer':'transportation',minzoom:10,filter:local,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#e2a45a','line-width':['interpolate',['linear'],['zoom'],10,1,13,2,16,4],'line-blur':1.2,'line-opacity':.17}},
   {id:'arterial-glow',type:'line',source:'world','source-layer':'transportation',filter:major,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':color,'line-width':['interpolate',['linear'],['zoom'],5,1,9,2.5,12,4,16,9],'line-blur':2,'line-opacity':.35}},
   {id:'local-lamps',type:'line',source:'world','source-layer':'transportation',minzoom:10,filter:local,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#e1a45b','line-width':['interpolate',['linear'],['zoom'],10,.35,13,.65,16,1.3],'line-opacity':.68,'line-dasharray':[.5,1.4]}},
   {id:'arterial-lamps',type:'line',source:'world','source-layer':'transportation',filter:major,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':color,'line-width':['interpolate',['linear'],['zoom'],5,.2,9,.4,12,.75,16,2.2],'line-opacity':.95}},
   {id:'overview-borders',type:'line',source:'world','source-layer':'boundary',layout:{visibility:'none'},paint:{'line-color':'#8b9da5','line-opacity':.4,'line-width':.6}},
   {id:'overview-labels',type:'symbol',source:'world','source-layer':'place',layout:{visibility:'none','text-field':['coalesce',['get','name:en'],['get','name_en'],['get','name:latin'],['get','name']],'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],0,10,6,12,12,14],'text-max-width':12,'symbol-sort-key':['coalesce',['get','rank'],100]},paint:{'text-color':'#dbe4e5','text-halo-color':'#1b2630','text-halo-width':1.5}},
   {id:'runways',type:'line',source:'world','source-layer':'aeroway',minzoom:10,filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#c3cbcc','line-width':['interpolate',['linear'],['zoom'],10,.4,14,1.5],'line-opacity':.5,'line-dasharray':[1,2]}}
  ]};
}
