import {readFile, access, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve, join} from 'node:path';
import assert from 'node:assert/strict';

const data = JSON.parse(await readFile('lee/catalogue.json', 'utf8'));
const input = JSON.parse(await readFile('lee/research/sequence-index.json', 'utf8'));
const notes = JSON.parse(await readFile('lee/research/annotations.json', 'utf8'));
assert.equal(data.schemaVersion, 1);
assert.equal(data.entries.length, 42);
assert.equal(new Set(data.entries.map(e => e.id)).size, 42);
assert.equal(data.movementCount, 140);
assert.equal(data.entries[14].end, 50);
assert.deepEqual(data.entries.filter(e => e.position.kind === 'Evidence gap').map(e => e.ordinal), [11, 12, 13, 16, 27]);
const movements = new Map();
for (const [i, e] of data.entries.entries()) {
  assert.equal(e.ordinal, i + 1);
  for (const key of ['id', 'name', 'start', 'end', 'video', 'directory']) assert.equal(e[key], input[i][key], `${e.id}: stale ${key}`);
  assert.equal(e.position.text, notes[i].position, `${e.id}: stale annotation`);
  assert.equal(e.attention.text, notes[i].attention);
  assert.equal(e.previous, data.entries[i - 1]?.id ?? null);
  assert.equal(e.next, data.entries[i + 1]?.id ?? null);
  assert.equal(e.historicalMatch, 'unverified');
  assert(!e.mesh && !e.pose && !e.images, 'No unaudited historical or model matches');
  assert.match(e.video, /^[\w-]{11}$/);
  assert(e.start <= e.end && e.start >= 1 && e.end <= 140);
  if (i < 40) assert.equal(e.start, i === 0 ? 1 : data.entries[i - 1].end + 1);
  for (let n = e.start; n <= e.end; n++) movements.set(n, [...(movements.get(n) ?? []), e.ordinal]);
  for (const source of [e.position.source, e.application.source, e.comparison].filter(Boolean)) assert(data.sources[source], `${e.id}: missing ${source}`);
  assert.equal(e.pdfPage, i < 5 ? 24 + i * 2 : null);
  if (e.sharedRange) {assert([41, 42].includes(e.ordinal)); assert.equal(e.start, 138); assert.equal(e.end, 140);}
  await access(`lee/${e.directory}/index.html`);
}
assert.equal(movements.size, 140);
for (let n = 1; n <= 140; n++) assert.equal(movements.get(n).length, n >= 138 ? 2 : 1, `Movement ${n}: unexpected overlap or hole`);
assert.equal(new Set(data.entries.map(e => e.video)).size, 41);
for (const source of Object.values(data.sources)) {
  assert(new URL(source.url).protocol === 'https:');
  for (const key of ['title', 'author', 'kind', 'date', 'note']) assert(source[key]?.length, `Source lacks ${key}`);
  if (source.local) await access(`lee/${source.local}`);
}
const pdf = await readFile('lee/sources/gibbon-first-five-sets.pdf');
assert.equal(createHash('sha256').update(pdf).digest('hex'), 'a01dd9dc5de920d760582a9901366498c0a77d26503f301989f756d68f0888fe', 'Distribution permission requires the unmodified PDF');

async function checkLinks(file) {
  const html = await readFile(file, 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, `${file}: duplicate ID`);
  for (const [, href] of html.matchAll(/(?:href|src)="([^"\s]+)"/g)) {
    if (/^(https?:|data:)/.test(href)) continue;
    const [path, hash] = href.split('#');
    const target = path ? resolve(dirname(file), path) : resolve(file);
    assert(target === resolve('.') || target.startsWith(resolve('.') + '/'), `${file}: escaping link`);
    await access(target);
    if (!path && hash && !hash.startsWith('set=')) assert(ids.includes(hash), `${file}: missing #${hash}`);
  }
}
await checkLinks('lee/index.html');
await checkLinks('lee/sequence.html');
for (const dir of await readdir('lee/poses')) await checkLinks(join('lee/poses', dir, 'index.html'));
const html = await readFile('index.html', 'utf8');
assert(html.includes('href="lee/"'));
const workflow = await readFile('.github/workflows/pages.yml', 'utf8');
assert(workflow.includes('node tools/check-lee.mjs'));
assert.match(workflow, /cp -R[^\n]+\blee\b[^\n]+_site\//);
console.log('PASS: 42 Lee sets / 140 unique movements; shared closing boundary, 41 lesson links, source references, static pages, PDF integrity and Pages staging.');
