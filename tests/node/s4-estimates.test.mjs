// PE-34 (published estimates are allowlisted) and PE-35 (the shipped index is well-formed; empty until estimates are published), node halves; slice S4.
// The corpus checks are generic over the shipped directory, so they bite as soon as the first estimate is published;
// with the shipped empty index they confirm only the invariants that hold for an empty corpus.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {ROOT} from '../helpers/files.mjs';
import {fixture, fixtureText} from '../helpers/poses.mjs';

const DIR = path.join(ROOT, 'assets/pose-estimates');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const schema = () => import('../../assets/explorer/pose-schema.js');
const poses = () => import('../../assets/explorer/poses.js');
const indexText = () => readFileSync(path.join(DIR, 'index.json'), 'utf8');

// ---------------------------------------------------------------- PE-35 / PE-34: the shipped index
test('PE-35 assets/pose-estimates/index.json is well-formed and every entry names a present, hash-matching file', async () => {
  const index = JSON.parse(indexText());
  assert.equal(index.schema, 'yang-form/pose-estimate-index');
  assert.equal(index.schemaVersion, 1);
  assert.deepEqual(Object.keys(index).sort(), ['estimates', 'schema', 'schemaVersion']);
  assert.ok(Array.isArray(index.estimates));
  const {createHash} = await import('node:crypto');
  const seen = new Set();
  for (const e of index.estimates) {
    assert.match(e.imageId, /^(yang|chen)-\d{3}$/, `imageId ${e.imageId}`);
    assert.equal(e.file, `${e.imageId}.json`, `file for ${e.imageId}`);
    assert.ok(!seen.has(e.imageId), `duplicate ${e.imageId}`);
    seen.add(e.imageId);
    const bytes = readFileSync(new URL(`../../assets/pose-estimates/${e.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), e.sha256, `sha256 for ${e.imageId}`);
  }
});

test('PE-34 the shipped index validates', async () => {
  const {validateIndex} = await schema();
  const r = validateIndex(indexText());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(validateIndex(JSON.parse(indexText())).ok, true, 'also from a parsed value');
});

test('PE-34 ADR-0003: SAM-LICENSE.txt ships beside the data', () => {
  const file = path.join(DIR, 'SAM-LICENSE.txt');
  assert.ok(existsSync(file), 'assets/pose-estimates/SAM-LICENSE.txt is missing');
  const text = readFileSync(file, 'utf8');
  assert.ok(text.length > 1000, 'it should be the full licence text');
  assert.match(text, /SAM License/i);
});

// ---------------------------------------------------------------- PE-34: validateIndex
const entry = {imageId: 'chen-001', file: 'chen-001.json', sha256: 'a'.repeat(64)};
const index = (...estimates) => ({schema: 'yang-form/pose-estimate-index', schemaVersion: 1, estimates});
const reject = async (value, code) => {
  const {validateIndex} = await schema();
  let r; assert.doesNotThrow(() => { r = validateIndex(value); });
  assert.equal(r.ok, false, JSON.stringify(value));
  if (code) assert.equal(r.errors[0].code, code, JSON.stringify(r.errors[0]));
  assert.ok(r.errors.every(e => typeof e.code === 'string' && typeof e.path === 'string' && typeof e.message === 'string'));
};

test('PE-34 validateIndex accepts one well-formed entry, from a value and from text', async () => {
  const {validateIndex} = await schema();
  assert.equal(validateIndex(index(entry)).ok, true);
  assert.equal(validateIndex(JSON.stringify(index(entry, {imageId: 'yang-002', file: 'yang-002.json', sha256: 'b'.repeat(64)}))).ok, true);
});

for (const [label, value, code] of [
  ['wrong schema', {...index(), schema: 'yang-form/other'}, 'E_SCHEMA_ID'],
  ['schemaVersion 2', {...index(), schemaVersion: 2}, 'E_VERSION'],
  ['schemaVersion "1"', {...index(), schemaVersion: '1'}, 'E_VERSION'],
  ['unknown top-level key', {...index(), note: 'x'}, 'E_UNKNOWN_KEY'],
  ['unknown entry key', index({...entry, url: 'https://example.com/x.json'}), 'E_UNKNOWN_KEY'],
  ['missing estimates', {schema: 'yang-form/pose-estimate-index', schemaVersion: 1}, 'E_MISSING'],
  ['file not equal to <imageId>.json', index({...entry, file: 'chen-002.json'}), 'E_IMAGE_ID'],
  ['file with a path', index({...entry, file: '../chen-001.json'}), 'E_IMAGE_ID'],
  ['file with a URL', index({...entry, file: 'https://example.com/chen-001.json'}), 'E_IMAGE_ID'],
  ['drawing id (panels never have estimates)', index({imageId: 'panel-001', file: 'panel-001.json', sha256: 'a'.repeat(64)}), 'E_IMAGE_ID'],
  ['upper-case sha256', index({...entry, sha256: 'A'.repeat(64)}), 'E_HASH'],
  ['short sha256', index({...entry, sha256: 'a'.repeat(63)}), 'E_HASH'],
  ['estimates not an array', {...index(), estimates: {}}, null],
  ['entry that is a string', index('chen-001'), null],
  ['duplicate imageId', index(entry, {...entry}), null],
  ['not JSON', 'nope', 'E_JSON'],
  ['null', null, null],
  ['array', [], null],
]) test(`PE-34 validateIndex rejects: ${label}`, () => reject(value, code));

test('PE-34 validateIndex rejects a "__proto__" key in raw text and pollutes nothing', async () => {
  const {validateIndex} = await schema();
  const r = validateIndex('{"schema":"yang-form/pose-estimate-index","schemaVersion":1,"estimates":[],"__proto__":{"polluted":true}}');
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'E_UNKNOWN_KEY');
  assert.equal({}.polluted, undefined);
});

// ---------------------------------------------------------------- PE-34: the shipped corpus (generic)
test('PE-34 every index entry names an existing file that validates as published, with matching id and hash; no unindexed pose files', async () => {
  const {validatePose} = await schema();
  const entries = JSON.parse(indexText()).estimates;
  const listed = new Set();
  for (const e of entries) {
    assert.match(e.file, /^(yang|chen)-\d{3}\.json$/);
    assert.equal(e.file, `${e.imageId}.json`);
    const file = path.join(DIR, e.file);
    assert.ok(existsSync(file), `${e.file} listed but missing`);
    const bytes = readFileSync(file);
    assert.equal(sha256(bytes), e.sha256, `${e.file}: index hash differs from the file`);
    const r = validatePose(bytes.toString('utf8'), {origin: 'published'});
    assert.equal(r.ok, true, `${e.file}: ${JSON.stringify(r.errors)}`);
    assert.equal(r.pose.imageId, e.imageId);
    const png = path.join(ROOT, 'extracted/historical', `${e.imageId}.png`);
    assert.ok(existsSync(png), `${png} missing`);
    assert.equal(sha256(readFileSync(png)), r.pose.sourceImage.sha256, `${e.file}: sourceImage.sha256 differs from the PNG`);
    listed.add(e.file);
  }
  const onDisk = readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
  assert.deepEqual(onDisk.filter(f => !listed.has(f)), [], 'pose files on disk that the index does not list');
  assert.ok(readdirSync(DIR).every(f => !statSync(path.join(DIR, f)).isDirectory()), 'no sub-directories');
});

test('PE-34 every published pose file also passes the left/right check', async () => {
  const {checkLeftRight} = await import('../../assets/explorer/retarget.js');
  const {restData} = await import('../helpers/poses.mjs');
  for (const e of JSON.parse(indexText()).estimates) {
    const r = checkLeftRight(restData, JSON.parse(readFileSync(path.join(DIR, e.file), 'utf8')));
    assert.equal(r.ok, true, `${e.file}: ${JSON.stringify(r.errors)}`);
  }
});

// ---------------------------------------------------------------- PE-34/35: poses.js against a stubbed fetch (the only mock: the network)
function withFetch(routes, fn) {
  return async () => {
    const calls = [], original = globalThis.fetch;
    globalThis.fetch = async url => {
      calls.push(String(url));
      const hit = routes[String(url).split('/').pop()];
      if (hit === undefined) return new Response('not found', {status: 404});
      return new Response(hit, {status: 200});
    };
    try { await fn(calls); } finally { globalThis.fetch = original; }
  };
}
const BASE = new URL('http://localhost/assets/pose-estimates/');
const fullText = () => fixtureText('valid-full.json');

test('PE-35 loadIndex with the shipped index issues exactly one request, for index.json, and yields one entry per listed estimate', withFetch({'index.json': indexText()}, async calls => {
  const {loadIndex} = await poses();
  const r = await loadIndex(BASE);
  assert.equal(r.ok, true);
  assert.equal(r.entries.size, JSON.parse(indexText()).estimates.length);
  assert.deepEqual(calls, ['http://localhost/assets/pose-estimates/index.json']);
}));

test('PE-34 loadIndex returns the allowlist as imageId → {file, sha256}', withFetch({'index.json': JSON.stringify(index(entry))}, async calls => {
  const {loadIndex} = await poses();
  const r = await loadIndex(BASE);
  assert.equal(r.ok, true);
  assert.deepEqual([...r.entries], [['chen-001', {file: 'chen-001.json', sha256: entry.sha256}]]);
  assert.equal(calls.length, 1);
}));

test('PE-35 loadIndex never rejects: a 404, a network failure and garbage all resolve to ok:false', async () => {
  const {loadIndex} = await poses();
  const original = globalThis.fetch;
  try {
    for (const impl of [async () => new Response('no', {status: 404}), async () => { throw new TypeError('network down'); }, async () => new Response('<html>', {status: 200})]) {
      globalThis.fetch = impl;
      const r = await loadIndex(BASE);
      assert.equal(r.ok, false);
      assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
    }
  } finally { globalThis.fetch = original; }
});

test('PE-34 fetchEstimate fetches <file> from the index entry only, checks the hash and validates as published', withFetch({'chen-001.json': fullText()}, async calls => {
  const {fetchEstimate} = await poses();
  const good = {file: 'chen-001.json', sha256: sha256(Buffer.from(fullText()))};
  const r = await fetchEstimate(BASE, good);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.pose.imageId, 'chen-001');
  assert.deepEqual(calls, ['http://localhost/assets/pose-estimates/chen-001.json']);
}));

test('PE-34 fetchEstimate rejects a file whose bytes do not match the index hash (E_HASH)', withFetch({'chen-001.json': fullText()}, async () => {
  const {fetchEstimate} = await poses();
  const r = await fetchEstimate(BASE, {file: 'chen-001.json', sha256: 'f'.repeat(64)});
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'E_HASH');
}));

test('PE-34 fetchEstimate never requests a name that is not <yang|chen>-NNN.json', withFetch({}, async calls => {
  const {fetchEstimate} = await poses();
  for (const file of ['../evil.json', 'index.json', 'https://example.com/chen-001.json', 'chen-001.json?x=1', '/chen-001.json', 'panel-001.json', undefined, '']) {
    const r = await fetchEstimate(BASE, {file, sha256: 'a'.repeat(64)});
    assert.equal(r.ok, false, String(file));
  }
  assert.deepEqual(calls, [], 'no request may be made for a non-allowlisted name');
}));

test('PE-34 fetchEstimate applies the published rules: a draft file is rejected even with a matching hash', withFetch({}, async () => {
  const draft = JSON.stringify({...fixture('valid-full.json'), review: {...fixture('valid-full.json').review, status: 'draft'}});
  globalThis.fetch = async () => new Response(draft, {status: 200});
  const {fetchEstimate} = await poses();
  const r = await fetchEstimate(BASE, {file: 'chen-001.json', sha256: sha256(Buffer.from(draft))});
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'E_STATUS');
}));

test('PE-34 fetchEstimate resolves to ok:false on 404 or a network error (never rejects)', async () => {
  const {fetchEstimate} = await poses();
  const original = globalThis.fetch;
  try {
    for (const impl of [async () => new Response('no', {status: 404}), async () => { throw new TypeError('down'); }]) {
      globalThis.fetch = impl;
      assert.equal((await fetchEstimate(BASE, {file: 'chen-001.json', sha256: 'a'.repeat(64)})).ok, false);
    }
  } finally { globalThis.fetch = original; }
});

test('PE-21 (node) readLocalFile validates with origin "local": a draft is readable, an oversized file is E_SIZE, junk is E_JSON', async () => {
  const {readLocalFile} = await poses();
  const file = text => ({size: Buffer.byteLength(text), text: async () => text});
  const draft = JSON.stringify({...fixture('valid-full.json'), review: {...fixture('valid-full.json').review, status: 'draft'}});
  assert.equal((await readLocalFile(file(draft))).ok, true);
  assert.equal((await readLocalFile(file(fullText()))).ok, true);
  assert.equal((await readLocalFile({size: 70000, text: async () => fullText()})).errors[0].code, 'E_SIZE');
  assert.equal((await readLocalFile(file('not json'))).errors[0].code, 'E_JSON');
});
