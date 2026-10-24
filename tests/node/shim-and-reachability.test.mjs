// PE-01: viewer.js is a one-line shim; every explorer module is reachable from main.js; check-site still passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {ROOT, read, explorerFiles, importsOf} from '../helpers/files.mjs';

test('PE-01 assets/viewer.js is a shim of at most 3 non-blank lines importing ./explorer/main.js', () => {
  const lines = read('assets/viewer.js').split('\n').filter(l => l.trim());
  assert.ok(lines.length <= 3, `viewer.js has ${lines.length} non-blank lines`);
  assert.match(lines.join('\n'), /import\s+(?:[^'"]*from\s+)?['"]\.\/explorer\/main\.js['"]/);
});

test('PE-01 assets/explorer/main.js exists', () => {
  assert.ok(existsSync(path.join(ROOT, 'assets/explorer/main.js')), 'assets/explorer/main.js is missing');
});

test('PE-01 every file in assets/explorer/ is imported, directly or transitively, from main.js', () => {
  const files = explorerFiles();
  const bySpec = new Map(files.map(f => [f.name, f]));
  assert.ok(bySpec.has('main.js'), 'main.js is missing');
  const seen = new Set(['main.js']), queue = ['main.js'];
  while (queue.length) {
    const file = bySpec.get(queue.pop());
    for (const {spec} of importsOf(file.source)) {
      const m = spec?.match(/^\.\/([\w-]+\.js)$/);
      if (m && bySpec.has(m[1]) && !seen.has(m[1])) { seen.add(m[1]); queue.push(m[1]); }
    }
  }
  const orphans = files.map(f => f.name).filter(n => !seen.has(n));
  assert.deepEqual(orphans, [], `unreachable from main.js: ${orphans.join(', ')}`);
});

test('PE-01 node tools/check-site.mjs exits 0', () => {
  const run = spawnSync(process.execPath, ['tools/check-site.mjs'], {cwd: ROOT, encoding: 'utf8'});
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
