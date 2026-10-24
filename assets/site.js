const $ = id => document.getElementById(id);
const sourceNames = {montage:'Drawings',yang:'Yang · 1931',chen:'Chen · 1933'};
const statusNames = {'direct':'Direct sequence match','endpoint-reference':'Endpoint reference only','reused':'Reused posture reference','shared-series':'Shared series image','direct-with-reused-photo':'Reused historical reference','direct-with-naming-caveat':'Side-naming convention differs','direct-with-variant':'Historical variant comparison'};
let catalogue=[], current=null, source='montage', imageIndex=0;
const node = (tag, text, className) => {const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
function filterList(){
  const scrollTop=$('position-list').scrollTop;
  const query=$('search').value.trim().toLowerCase(), section=$('section-filter').value;
  const matches=catalogue.filter(m=>(section==='all'||String(m.section)===section)&&(!query||m.name.toLowerCase().includes(query)||String(m.id)===query||String(m.id).padStart(3,'0')===query||m.family.includes(query)));
  $('result-count').textContent=`${matches.length} of ${catalogue.length} positions`;
  $('position-list').replaceChildren(...matches.map(m=>{const a=node('a');a.href=`#move=${m.id}`;a.className='position-link';a.dataset.id=m.id;a.append(node('span',String(m.id).padStart(3,'0'),'num'),node('span',m.name));if(current?.id===m.id)a.setAttribute('aria-current','true');return a;}));
  if(!matches.length)$('position-list').append(node('p','No matching position. Try another name or section.','small'));
  $('position-list').scrollTop=scrollTop;
  const active=$('position-list').querySelector('[aria-current]');
  if(active){const list=$('position-list'),bounds=list.getBoundingClientRect(),row=active.getBoundingClientRect();if(row.top<bounds.top)list.scrollTop+=row.top-bounds.top;else if(row.bottom>bounds.bottom)list.scrollTop+=row.bottom-bounds.bottom;}
}
function showImage(){
  const images=current.images.filter(im=>im.source===source), im=images[imageIndex];
  if(!im)return;
  $('pose-image').src=im.src;$('pose-image').alt=`${current.name}: ${im.label}`;
  $('full-image').href=im.src;$('image-caption').textContent=im.label;$('image-source').href=im.url;
  $('thumbnails').replaceChildren(...images.map((img,i)=>{const b=node('button');b.type='button';b.setAttribute('aria-label',`View ${img.label}`);b.setAttribute('aria-pressed',String(i===imageIndex));const thumb=node('img');thumb.src=img.src;thumb.alt='';thumb.loading='lazy';b.append(thumb);b.onclick=()=>{imageIndex=i;showImage();$('thumbnails').children[i].focus({preventScroll:true});};return b;}));
}
function showSources(){
  const available=Object.keys(sourceNames).filter(s=>current.images.some(im=>im.source===s));
  if(!available.includes(source))source=available[0];
  $('source-filters').replaceChildren(...available.map(s=>{const b=node('button',sourceNames[s]);b.type='button';b.dataset.source=s;b.setAttribute('aria-pressed',String(s===source));b.onclick=()=>{source=s;imageIndex=0;showSources();$('source-filters').querySelector(`[data-source="${s}"]`).focus({preventScroll:true});};return b;}));
  showImage();
}
function selectMove(id){
  const move=catalogue.find(m=>m.id===id);
  if(!move){$('route-status').textContent=`Position ${id} is not in the supplied list. The displayed entry has not changed.`;return;}
  current=move;imageIndex=0;
  $('route-status').textContent='';$('study').setAttribute('aria-busy','false');
  $('move-number').textContent=`No. ${String(move.id).padStart(3,'0')} / Section ${['I','II','III'][move.section-1]} / Entry ${move.ordinal} of 103`;
  $('move-title').textContent=move.name;document.title=`${move.name} — The Yang form`;
  for(const [field,target] of Object.entries({position:'position-note',transition:'transition-note',application:'application-note',attention:'attention-note',nameContext:'name-note',breathing:'breathing-note',mappingNote:'mapping-note'}))$(target).textContent=move[field];
  $('match-label').textContent=statusNames[move.status]||move.status;
  $('sequence-context').textContent=`Before: ${move.previous?.name||'Start of form'}. Next: ${move.next?.name||'End of form'}.`;
  $('previous').disabled=!move.previous;$('next').disabled=!move.next;
  $('entry-notes').href=`${move.directory}/README.md`;
  const used=[...new Map(move.images.map(im=>[im.source,im])).values()];
  $('entry-sources').replaceChildren(...used.map(im=>{const li=node('li'),a=node('a',im.source==='montage'?'Drawing montage · Matthias Wagner':im.source==='yang'?'Yang Chengfu · 1931 manual':'Chen Weiming · 1933 supplement');a.href=im.url;li.append(a);return li;}));
  showSources();filterList();
}
function route(){const match=location.hash.match(/^#move=(\d+)$/);if(match)selectMove(Number(match[1]));}
$('search').addEventListener('input',filterList);$('section-filter').addEventListener('change',filterList);
$('previous').onclick=()=>{if(current?.previous)location.hash=`move=${current.previous.id}`;};$('next').onclick=()=>{if(current?.next)location.hash=`move=${current.next.id}`;};
document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#move="]');if(a&&!a.classList.contains('position-link'))setTimeout(()=>$('explore').scrollIntoView(),0);if(a?.classList.contains('position-link')&&matchMedia('(max-width:920px)').matches)setTimeout(()=>$('study').scrollIntoView(),0);});
window.addEventListener('hashchange',route);
try{const response=await fetch(new URL('./catalogue.json',import.meta.url));if(!response.ok)throw new Error(`HTTP ${response.status}`);catalogue=await response.json();selectMove(2);route();}catch(error){$('move-title').textContent='The catalogue could not be loaded';$('result-count').textContent='Please reload the page.';$('route-status').textContent=error.message;$('study').setAttribute('aria-busy','false');}
// Viewer is deliberately separate: selecting a catalogue entry does not mutate its rig.
import('./viewer.js').catch(error=>{$('model-status').textContent='The 3D viewer is unavailable. The image archive remains accessible.';console.error(error);});
