const $ = id => document.getElementById(id);
const link = (label, href) => Object.assign(document.createElement('a'), {textContent: label, href});
const paragraph = text => Object.assign(document.createElement('p'), {textContent: text});
let catalogue, selected, mediaMode = 'video';

function sourceLink(id) {
  const source = catalogue.sources[id];
  return link(source.title, source.url);
}

function showMedia() {
  const e = selected;
  const stage = $('media');
  stage.replaceChildren();
  stage.classList.remove('loaded');
  $('video-tab').setAttribute('aria-pressed', String(mediaMode === 'video'));
  $('photo-tab').hidden = !e.pdfPage;
  $('photo-tab').setAttribute('aria-pressed', String(mediaMode === 'photo'));
  const intro = document.createElement('div');
  intro.className = 'media-intro';
  const eyebrow = paragraph(mediaMode === 'photo' ? 'HOWARD GIBBON · LATER PHOTOGRAPHS' : 'WEST YORKSHIRE TAI CHI · LATER DEMONSTRATION');
  eyebrow.className = 'eyebrow';
  const heading = Object.assign(document.createElement('h5'), {textContent: e.name});
  const load = Object.assign(document.createElement('button'), {textContent: mediaMode === 'photo' ? `View photograph page ${e.pdfPage}` : 'Load the video lesson'});
  const url = mediaMode === 'photo' ? `sources/gibbon-first-five-sets.pdf#page=${e.pdfPage}` : `https://www.youtube.com/watch?v=${e.video}`;
  const external = link(mediaMode === 'photo' ? 'Open the complete PDF ↗' : 'Watch on YouTube ↗', url);
  external.target = '_blank'; external.rel = 'noopener';
  intro.append(eyebrow, heading, paragraph(`Movements ${e.rangeLabel}`), load, paragraph(''));
  intro.lastChild.append(external);
  stage.append(intro);
  $('media-caption').textContent = mediaMode === 'photo'
    ? `Page ${e.pdfPage} shows the photographed phases; instructions are on the preceding page. The full manual retains its original layout and aspect ratios. These are later teaching photographs, not Chee Soo’s historical plates.`
    : 'Lesson linked by West Yorkshire Tai Chi. Loading contacts YouTube; the external link remains available if embedding is disabled. The lesson’s title and range are checked against its publisher’s index; individual video frames have not been audited.';
  load.addEventListener('click', () => {
    const frame = document.createElement('iframe');
    frame.title = `${mediaMode === 'photo' ? 'Howard Gibbon photograph manual' : 'West Yorkshire Tai Chi video lesson'}: ${e.name}`;
    if (mediaMode === 'photo') {
      frame.src = url; frame.className = 'manual';
    } else {
      frame.src = `https://www.youtube-nocookie.com/embed/${e.video}`;
      frame.allow = 'fullscreen; picture-in-picture';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
    }
    stage.replaceChildren(frame); stage.classList.add('loaded');
    // Keep an accessible exit and direct-source fallback after media loads.
    $('media-caption').append(' ', external);
  }, {once: true});
}

function selectEntry(ordinal, message = '') {
  selected = catalogue.entries[ordinal - 1];
  const e = selected;
  if (mediaMode === 'photo' && !e.pdfPage) mediaMode = 'video';
  $('move-number').textContent = `SET ${e.ordinal} OF 42 · MOVEMENTS ${e.rangeLabel}`;
  $('move-title').textContent = e.name;
  document.title = `${e.name} · Lee main form`;
  $('previous').disabled = !e.previous;
  $('next').disabled = !e.next;
  $('route-status').textContent = message;
  $('position-kind').textContent = e.position.kind.toUpperCase();
  $('position-note').textContent = e.position.text;
  $('position-source').replaceChildren(sourceLink(e.position.source));
  $('application-kind').textContent = e.application.kind.toUpperCase();
  $('application-note').textContent = e.application.text;
  $('application-source').replaceChildren(...(e.application.source ? [sourceLink(e.application.source)] : []));
  $('attention-note').textContent = e.attention.text;
  $('transition-note').textContent = e.sharedRange
    ? 'The video index groups the closing movements 138–140. Separate names are confirmed by Wood’s course list, but the exact numbered boundary is unresolved. No individual frame or pose is assigned across that boundary.'
    : 'The neighbouring sets below establish the documented order. Their precise physical join should be checked in the lesson; the catalogue does not infer it from the names.';
  const neighbours = [catalogue.entries[e.ordinal - 2], catalogue.entries[e.ordinal]].filter(Boolean);
  $('transition-links').replaceChildren();
  for (const neighbour of neighbours) {
    if ($('transition-links').childNodes.length) $('transition-links').append(' · ');
    $('transition-links').append(link(`${neighbour.ordinal < e.ordinal ? 'From' : 'Into'} set ${neighbour.ordinal}: ${neighbour.name}`, `#set=${neighbour.ordinal}`));
  }
  $('comparison').replaceChildren();
  if (e.comparison) {
    $('comparison').append(Object.assign(document.createElement('h4'), {textContent: 'Compare the versions'}), paragraph('This author describes a particular version or a difference between schools. Keep its stance and hand details together when comparing it with another record.'), sourceLink(e.comparison));
  }
  const ids = new Set(['wy', 'book', e.position.source, e.application.source, e.comparison, e.teachingUrl ? `teacher-${String(e.ordinal).padStart(2, '0')}` : null].filter(Boolean));
  $('entry-sources').replaceChildren(...[...ids].map(id => {
    const li = document.createElement('li'); li.append(sourceLink(id), ` · ${catalogue.sources[id].kind}`); return li;
  }));
  $('entry-notes').href = `${e.directory}/`;
  $('evidence-note').textContent = e.position.kind === 'Evidence gap'
    ? 'The sequence name, range and lesson link are documented. Detailed written mechanics remain unverified here. No historical image or model pose is assigned.'
    : 'The description is attributed to later teaching. It has not been matched to Chee Soo’s historical plates; differences between schools remain visible.';
  $('study').setAttribute('aria-busy', 'false');
  renderList(); showMedia();
  for (const a of $('sequence-map').querySelectorAll('a')) {
    if (a.hash === `#set=${e.ordinal}`) a.setAttribute('aria-current', 'step');
    else a.removeAttribute('aria-current');
  }
}

function renderList() {
  const query = $('search').value.trim().toLowerCase();
  const section = $('section-filter').value;
  const movement = query.match(/^move(?:ment)?\s+(\d+)$/);
  const set = query.match(/^set\s+(\d+)$/);
  const rows = catalogue.entries.filter(e => {
    if (section === 'opening' && e.ordinal > 15) return false;
    if (section === 'continuation' && e.ordinal < 16) return false;
    if (section === 'photographs' && !e.pdfPage) return false;
    if (movement) return +movement[1] >= e.start && +movement[1] <= e.end;
    if (set) return e.ordinal === +set[1];
    return !query || e.name.toLowerCase().includes(query) || (/^\d+$/.test(query) && (e.ordinal === +query || (+query >= e.start && +query <= e.end)));
  });
  $('result-count').textContent = `${rows.length} of 42 sets${rows.some(e => e.id === selected?.id) ? '' : ' · selected set is outside this filter'}`;
  $('position-list').replaceChildren(...rows.map(e => {
    const a = link('', `#set=${e.ordinal}`);
    a.className = 'position-link';
    const number = Object.assign(document.createElement('span'), {className: 'num', textContent: String(e.ordinal).padStart(2, '0')});
    a.append(number, e.name);
    if (e.id === selected?.id) a.setAttribute('aria-current', 'step');
    return a;
  }));
}

function route(focus = false) {
  const hash = location.hash;
  const match = hash.match(/^#set=(\d+)$/);
  if (!match && !hash.startsWith('#set=')) {
    if (!selected) selectEntry(1);
    return;
  }
  const number = match ? +match[1] : 0;
  const valid = number >= 1 && number <= 42;
  selectEntry(valid ? number : 1, valid ? '' : 'That set could not be found. Showing set 1; choose a set from the index.');
  if (focus) $('move-title').focus({preventScroll: true});
  $('study').scrollIntoView({block: 'start', behavior: 'instant'});
}

try {
  const response = await fetch(new URL('catalogue.json', import.meta.url));
  if (!response.ok) throw new Error(`Catalogue response ${response.status}`);
  catalogue = await response.json();
  if (catalogue.entries?.length !== 42) throw new Error('Incomplete catalogue');
  $('sequence-map').replaceChildren(...catalogue.entries.map(e => {
    const a = link(String(e.ordinal).padStart(2, '0'), `#set=${e.ordinal}`);
    a.title = e.name; a.setAttribute('aria-label', `Set ${e.ordinal}: ${e.name}`);
    if (e.ordinal <= 15) a.className = 'opening';
    return a;
  }));
  $('source-list').replaceChildren(...['book', 'interview', 'wy', 'gibbon', 'angie', 'swanson', 'double', 'pearson', 'archive-variant'].map(id => {
    const s = catalogue.sources[id]; const li = document.createElement('li');
    li.append(Object.assign(document.createElement('span'), {textContent: `${s.kind} · ${s.date}`}), sourceLink(id), paragraph(s.note));
    if (s.accessNote) li.append(paragraph(s.accessNote));
    if (s.archiveUrl) li.append(link('Archived publisher page ↗', s.archiveUrl));
    return li;
  }));
  $('search').addEventListener('input', renderList);
  $('section-filter').addEventListener('change', renderList);
  $('previous').addEventListener('click', () => {if (selected.previous) location.hash = `set=${selected.ordinal - 1}`;});
  $('next').addEventListener('click', () => {if (selected.next) location.hash = `set=${selected.ordinal + 1}`;});
  $('video-tab').addEventListener('click', () => {mediaMode = 'video'; showMedia();});
  $('photo-tab').addEventListener('click', () => {if (selected.pdfPage) {mediaMode = 'photo'; showMedia();}});
  window.addEventListener('hashchange', () => route(true));
  route();
} catch (error) {
  $('move-title').textContent = 'The interactive index could not load';
  $('route-status').replaceChildren('You can still use the ', link('complete static sequence index', 'sequence.html'), '.');
  $('result-count').textContent = 'Catalogue unavailable';
  $('study').setAttribute('aria-busy', 'false');
  console.error(error);
}
