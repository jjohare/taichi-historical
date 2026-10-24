// A static server for the repository root with an in-memory pose-estimate index (slice S5).
// The shipped index is empty (PE-35) and fixture estimates must never be committed into assets/, so the
// index and the pose files are served from memory over the real tree. Every request is recorded.
// S5_ROOT (optional) serves another checkout of the tree, e.g. `git archive <rev>` output, to record a baseline.
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './files.mjs';
import {SITE_URL} from './cdp.mjs';
import {fixtureText} from './poses.mjs';

const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.glb': 'model/gltf-binary', '.md': 'text/markdown', '.txt': 'text/plain'};
const SERVED_ROOT = path.resolve(process.env.S5_ROOT ?? ROOT);

/**
 * Page script for `openExplorer({init})`. The sidecar reaches this server by host name over plain http, which is not a
 * secure context, so Chrome withholds `crypto.subtle` and the explorer's index hash check (PE-30) could not run at all.
 * When that is the case, `digest` is delegated to the server, which hashes with node:crypto (nothing is hand-rolled).
 * Production is served over https and on localhost, where `crypto.subtle` exists and this shim does nothing.
 */
export const SUBTLE_SHIM = `if (!window.isSecureContext && !crypto.subtle) {
  Object.defineProperty(crypto, 'subtle', {value: {digest: async (algorithm, data) => {
    if (algorithm !== 'SHA-256') throw new Error('shim supports SHA-256 only');
    return (await fetch('/__sha256', {method: 'POST', body: data})).arrayBuffer();
  }}});
}`;

/** A published-looking pose file for `imageId`: valid-full.json with the image id replaced. Returns {text, sha256, object}. */
export function poseFile(imageId, {mutate} = {}) {
  const object = JSON.parse(fixtureText('valid-full.json'));
  object.imageId = imageId;
  object.sourceImage.path = `extracted/historical/${imageId}.png`;
  mutate?.(object);
  const text = JSON.stringify(object);
  return {text, sha256: createHash('sha256').update(text).digest('hex'), object};
}

/**
 * Serve the tree with an index listing `estimates` (image ids; each gets a pose file built by `poseFile`).
 * Resolves to {base, requests, poseRequests(), close()}; `base` is reachable from the browser sidecar via SITE_URL's host name.
 */
export async function serveSite({estimates = [], files = {}} = {}) {
  const poses = new Map(estimates.map(id => [id, poseFile(id)]));
  const index = JSON.stringify({schema: 'yang-form/pose-estimate-index', schemaVersion: 1, estimates: estimates.map(id => ({imageId: id, file: `${id}.json`, sha256: poses.get(id).sha256}))});
  const virtual = new Map([['/assets/pose-estimates/index.json', index], ...[...poses].map(([id, p]) => [`/assets/pose-estimates/${id}.json`, p.text]), ...Object.entries(files)]);
  const requests = [];
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const reply = (status, type, body) => { requests.push({path: pathname, status}); res.writeHead(status, {'content-type': type, 'cache-control': 'no-store'}); res.end(body); };
    if (pathname === '/__sha256' && req.method === 'POST') {
      const chunks = []; for await (const c of req) chunks.push(c);
      res.writeHead(200, {'content-type': 'application/octet-stream'}); return res.end(createHash('sha256').update(Buffer.concat(chunks)).digest());
    }
    if (pathname === '/favicon.ico') return reply(204, 'image/x-icon', ''); // the tree has none; a 404 would pollute the PE-35 "no 404" checks
    if (virtual.has(pathname)) return reply(200, TYPES['.json'], virtual.get(pathname));
    const file = path.join(SERVED_ROOT, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    if (!file.startsWith(SERVED_ROOT + path.sep)) return reply(403, 'text/plain', 'forbidden');
    try { reply(200, TYPES[path.extname(file)] ?? 'application/octet-stream', await readFile(file)); } catch { reply(404, 'text/plain', 'not found'); }
  });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  const base = `${new URL(SITE_URL).protocol}//${new URL(SITE_URL).hostname}:${server.address().port}/`;
  return {
    base, requests, poses,
    poseRequests: () => requests.filter(r => r.path.startsWith('/assets/pose-estimates/')).map(r => r.path.slice('/assets/pose-estimates/'.length)),
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}
