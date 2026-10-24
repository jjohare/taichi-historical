// PE-30 hash check on the native path: fetchEstimate with a stubbed fetch and Node's real crypto.subtle.
// The browser suite cannot cover this on a plain-http origin, where crypto.subtle is absent (see fixture-site.mjs).
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {fixtureText} from '../helpers/poses.mjs';
import {fetchEstimate} from '../../assets/explorer/poses.js';

const text = fixtureText('valid-full.json');
const sha256 = createHash('sha256').update(text).digest('hex');
const BASE = new URL('http://example.invalid/assets/pose-estimates/');

async function withFetch(body, fn) {
  const real = globalThis.fetch, seen = [];
  globalThis.fetch = async url => { seen.push(String(url)); return new Response(body, {status: 200}); };
  try { return await fn(seen); } finally { globalThis.fetch = real; }
}

test('fetchEstimate accepts a file whose SHA-256 matches the index entry, fetching only that file', () =>
  withFetch(text, async seen => {
    assert.ok(globalThis.crypto?.subtle, 'this Node has crypto.subtle');
    const result = await fetchEstimate(BASE, {file: 'chen-001.json', sha256});
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.pose.imageId, 'chen-001');
    assert.deepEqual(seen, ['http://example.invalid/assets/pose-estimates/chen-001.json']);
  }));

test('fetchEstimate rejects a wrong hash with E_HASH', () =>
  withFetch(text, async () => {
    const wrong = sha256.replace(/^./, c => (c === '0' ? '1' : '0'));
    const result = await fetchEstimate(BASE, {file: 'chen-001.json', sha256: wrong});
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'E_HASH');
  }));

test('fetchEstimate rejects a file name outside the allowlist pattern without fetching', () =>
  withFetch(text, async seen => {
    const result = await fetchEstimate(BASE, {file: '../x.json', sha256});
    assert.equal(result.ok, false);
    assert.deepEqual(seen, []);
  }));
