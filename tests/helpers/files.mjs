// Shared repository-file helpers for the static (node) tests.
import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const EXPLORER_DIR = path.join(ROOT, 'assets/explorer');
export const PURE_MODULES = ['provenance.js', 'presets.js', 'retarget.js', 'pose-schema.js'];

export const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');

/** Every `*.js` file in assets/explorer. Throws a clear message when the directory does not exist yet. */
export function explorerFiles() {
  if (!existsSync(EXPLORER_DIR) || !statSync(EXPLORER_DIR).isDirectory()) {
    throw new Error('assets/explorer/ does not exist: the S1 module split has not landed');
  }
  const files = readdirSync(EXPLORER_DIR).filter(f => f.endsWith('.js')).sort();
  if (!files.length) throw new Error('assets/explorer/ contains no .js modules');
  return files.map(name => ({name, path: path.join(EXPLORER_DIR, name), source: readFileSync(path.join(EXPLORER_DIR, name), 'utf8')}));
}

/** Remove comments so that prose such as "e.g. #fff" or "http://" in a comment is not scanned. Strings are kept. */
export function stripComments(source) {
  let out = '', i = 0, quote = null;
  while (i < source.length) {
    const c = source[i], n = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i = source.indexOf('*/', i + 2); i = i < 0 ? source.length : i + 2; continue; }
    out += c; i++;
  }
  return out;
}

/** Module specifiers: static `import … from 'x'`, bare `import 'x'`, `export … from 'x'` and dynamic `import(...)`. */
export function importsOf(source) {
  const code = stripComments(source);
  const found = [];
  for (const m of code.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?(['"])([^'"]+)\1/g)) found.push({kind: 'static', spec: m[2]});
  for (const m of code.matchAll(/\bimport\s*\(\s*([^)]*)\)/g)) {
    const lit = m[1].trim().match(/^(['"`])([^'"`]*)\1$/);
    found.push({kind: 'dynamic', spec: lit ? lit[2] : null, raw: m[1].trim()});
  }
  return found;
}
