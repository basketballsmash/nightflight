// Update checked-in version labels and cache keys; GitHub Pages needs no build step.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=file=>readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
const metadata=JSON.parse(read('version.json'));
const check=process.argv.includes('--check');
const requested=process.argv.slice(2).find(arg=>arg!=='--check');
const version=requested||metadata.version;
if(!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))throw new Error('Use a version such as 1.1.1');
const files=['index.html','offline.html','nightflight.css','nightflight.mjs','night-style.mjs','flight-math.mjs','place-lights.mjs','view-math.mjs','lights-worker.mjs','config.mjs'];
const asset=/(\.\/[^"'\s<>]+\.(?:mjs|js|css|html))(?:\?v=[^"'\s<>]*)?/g;
const label=/(<div\s+id="build-version"[^>]*>)[^<]*(<\/div>)/;
function canonical(text){return text.replace(asset,'$1').replace(label,'$1__BUILD__$2');}
const content=new Map(files.map(file=>[file,canonical(read(file))]));
const hash=createHash('sha256').update(version+'\n');
for(const [file,text]of content)hash.update(file+'\n'+text+'\n');
for(const file of ['vendor/maplibre-gl.mjs','vendor/maplibre-gl-worker.mjs','vendor/maplibre-gl.css'])hash.update(file+'\n'+read(file));
const build=hash.digest('hex').slice(0,8),token=`${version}-${build}`;
let stale=false;
for(const [file,text]of content){
 const mode=file==='offline.html'?'offline':'world';
 const output=text.replace(asset,(_,url)=>`${url}?v=${token}`).replace(label,`$1v${version} · ${build} · ${mode}$2`);
 if(output!==read(file)){stale=true;if(!check)writeFileSync(path.join(root,file),output);}
}
const output=JSON.stringify({version,build},null,2)+'\n';
if(read('version.json')!==output){stale=true;if(!check)writeFileSync(path.join(root,'version.json'),output);}
if(check&&stale){console.error('Version stamp is stale. Run node scripts/release.mjs before publishing.');process.exitCode=1;}
else console.log(`${check?'Verified':'Stamped'} Nightflight v${version} · ${build}`);
