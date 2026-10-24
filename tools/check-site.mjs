import {readFile,access,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const moves=JSON.parse(await readFile('assets/catalogue.json','utf8'));
assert.equal(moves.length,103);assert.equal(new Set(moves.map(m=>m.id)).size,103);
assert(!moves.some(m=>m.id===55));
const panels=new Set(),images=new Set();
for(const [i,m] of moves.entries()){
  assert.equal(m.ordinal,i+1);assert.equal(m.previous?.id,moves[i-1]?.id);assert.equal(m.next?.id,moves[i+1]?.id);
  assert(m.images.length>0);for(const key of ['position','transition','application','attention','breathing','nameContext','mappingNote'])assert(m[key]?.length>10,`${m.id}: ${key}`);
  await access(`${m.directory}/README.md`);
  for(const image of m.images){await access(image.src);images.add(image.src);assert(image.url.startsWith('https://'));if(image.source==='montage')panels.add(image.number);}
}
assert.equal(panels.size,104);assert.equal((await readdir('poses')).length,103);
const html=await readFile('index.html','utf8');
for(const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)){if(!/^(https?:|data:)/.test(match[1]))await access(match[1]);}
for(const file of ['assets/site.js','assets/viewer.js','assets/vendor/three.module.js','assets/vendor/three.core.js','assets/vendor/OrbitControls.js'])await access(file);
console.log(`PASS: 103 entries, 104 montage panels, ${images.size} image references; navigation, notes and local links validated.`);
