// Static scans of assets/explorer/*.js: PE-08 (static), PE-28, PE-29, PE-39, PE-40.
import test from 'node:test';
import assert from 'node:assert/strict';
import {explorerFiles, importsOf, stripComments, PURE_MODULES} from '../helpers/files.mjs';

/** Body text of the brace block that starts at or after `from`. */
function blockAt(code, from) {
  const open = code.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return code.slice(open, i + 1);
  }
  return code.slice(open);
}

test('PE-08 no setAnimationLoop anywhere in assets/explorer', () => {
  for (const f of explorerFiles()) assert.ok(!/setAnimationLoop/.test(stripComments(f.source)), `${f.name} uses setAnimationLoop`);
});

test('PE-08 a requestAnimationFrame callback never reschedules itself', () => {
  let sawRaf = false;
  for (const f of explorerFiles()) {
    const code = stripComments(f.source);
    for (const m of code.matchAll(/requestAnimationFrame\(\s*([A-Za-z_$][\w$]*|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)) {
      sawRaf = true;
      const arg = m[1];
      let body;
      if (arg.includes('=>')) body = blockAt(code, m.index + m[0].length - 1);
      else {
        const def = code.match(new RegExp(`function\\s+${arg.replace(/\$/g, '\\$')}\\s*\\(|\\b${arg.replace(/\$/g, '\\$')}\\s*=\\s*(?:\\([^)]*\\)|[\\w$]+)\\s*=>`));
        assert.ok(def, `${f.name}: cannot find the definition of rAF callback ${arg}`);
        body = blockAt(code, def.index);
      }
      assert.ok(!/requestAnimationFrame\s*\(|\brequestRender\s*\(/.test(body), `${f.name}: rAF callback ${arg} reschedules a frame`);
    }
  }
  assert.ok(sawRaf, 'expected render-on-demand to use requestAnimationFrame somewhere in assets/explorer');
});

test('PE-28 explorer modules total at most 64 KiB', () => {
  const total = explorerFiles().reduce((n, f) => n + Buffer.byteLength(f.source), 0);
  assert.ok(total <= 64 * 1024, `assets/explorer/*.js is ${total} bytes`);
});

test('PE-28 imports are limited to ./*.js, ../vendor/*.js and three', () => {
  const allowed = /^(?:three|\.\/[\w-]+\.js|\.\.\/vendor\/[\w.-]+\.js)$/;
  for (const f of explorerFiles()) for (const imp of importsOf(f.source)) {
    assert.ok(imp.spec !== null, `${f.name}: non-literal import(${imp.raw})`);
    assert.match(imp.spec, allowed, `${f.name}: disallowed import '${imp.spec}'`);
  }
});

test('PE-28 pure modules import only relative modules and ../vendor/three.core.js, and never touch the DOM', () => {
  const pure = explorerFiles().filter(f => PURE_MODULES.includes(f.name));
  for (const f of pure) {
    for (const {spec} of importsOf(f.source)) assert.match(spec, /^(?:\.\/[\w-]+\.js|\.\.\/vendor\/three\.core\.js)$/, `${f.name}: '${spec}'`);
    assert.ok(!/\b(?:document|window|WebGLRenderer)\b/.test(stripComments(f.source)), `${f.name} touches the DOM or WebGL`);
  }
});

test('PE-29 no http(s):// literal in assets/explorer', () => {
  for (const f of explorerFiles()) assert.ok(!/https?:\/\//.test(stripComments(f.source)), `${f.name} contains an absolute URL`);
});

test('PE-29 every fetch( argument is new URL(<relative>, import.meta.url | baseUrl)', () => {
  for (const f of explorerFiles()) {
    const code = stripComments(f.source);
    for (const m of code.matchAll(/(?<![\w$.])fetch\s*\(([^;]*)/g)) {
      assert.match(m[1], /^\s*new URL\(\s*(['"`])(?!https?:|\/\/)[^'"`]+\1\s*,\s*(?:import\.meta\.url|baseUrl)\s*\)/, `${f.name}: fetch(${m[1].slice(0, 60)}…`);
    }
  }
});

test('PE-39 no innerHTML, outerHTML, insertAdjacentHTML or document.write', () => {
  for (const f of explorerFiles()) {
    const hit = stripComments(f.source).match(/\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b|document\s*\.\s*write(?:ln)?\s*\(/);
    assert.equal(hit, null, `${f.name}: ${hit?.[0]}`);
  }
});

test('PE-40 no hex, rgb(, rgba(, hsl( or hsla( colour literal', () => {
  for (const f of explorerFiles()) {
    const code = stripComments(f.source);
    const hit = code.match(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\s*\(|\bColor\s*\(\s*0x[0-9a-fA-F]+/);
    assert.equal(hit, null, `${f.name}: ${hit?.[0]}`);
  }
});

test('PE-40 colours are read from CSS tokens (--name custom properties)', () => {
  const all = explorerFiles().map(f => stripComments(f.source)).join('\n');
  assert.match(all, /getComputedStyle\(/);
  assert.match(all, /['"`]--(?:floor|jade|accent|surface|muted|bg|border)['"`]/);
});
