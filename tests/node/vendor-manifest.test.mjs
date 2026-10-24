// PE-27 / ADR-0006: vendored libraries are pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {ROOT} from '../helpers/files.mjs';

const dir = path.join(ROOT, 'assets/vendor');
const manifest = () => {
  const entries = new Map();
  for (const line of readFileSync(path.join(dir, 'MANIFEST.sha256'), 'utf8').split('\n').filter(Boolean)) {
    const m = line.match(/^([0-9a-f]{64}) [ *](\S.*)$/);
    assert.ok(m, `malformed manifest line: ${line}`);
    assert.ok(!entries.has(m[2]), `duplicate manifest entry ${m[2]}`);
    entries.set(m[2], m[1]);
  }
  return entries;
};

test('PE-27 manifest lists exactly the files in assets/vendor except itself', () => {
  const onDisk = readdirSync(dir).filter(f => f !== 'MANIFEST.sha256').sort();
  assert.deepEqual([...manifest().keys()].sort(), onDisk);
});

test('PE-27 every listed hash matches the file bytes', () => {
  for (const [file, hash] of manifest()) {
    assert.equal(createHash('sha256').update(readFileSync(path.join(dir, file))).digest('hex'), hash, file);
  }
});

test('PE-27 listed files total 2,337,350 bytes (ADR-0006 baseline)', () => {
  const total = [...manifest().keys()].reduce((n, f) => n + readFileSync(path.join(dir, f)).length, 0);
  assert.equal(total, 2337350);
});
