// Slice S6 helpers (PE-42 to PE-59): a fixture tree of distinct estimates, a SHA-256 binding for pages without
// crypto.subtle (plain-http host names such as http://agentbox:*), and a per-frame recorder.
//
// Fixture: one Yang estimate per consecutive entry (ids 2..17), whose left_elbow bends by a zig-zag angle, so
// a straight start→target blend cannot pass for a route through the keyframes. Ids 0 and 1 share yang-001.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {ROOT} from './files.mjs';
import {openPage, SITE_URL} from './cdp.mjs';
import {serveSite} from './fixture-site.mjs';
import {makePose, axisAngle, fkPositions} from './poses.mjs';

export const catalogue = JSON.parse(readFileSync(path.join(ROOT, 'assets/catalogue.json'), 'utf8'));
export const bySequence = [...catalogue].sort((a, b) => a.ordinal - b.ordinal);
const imageOf = (entry, source) => entry.images.find(i => i.source === source)?.file.replace(/\.png$/, '') ?? null;
/** Keyframe image id of the catalogue entry `id` for `source` (the first image of that source, as site.js shows it). */
export const firstImage = (id, source = 'yang') => imageOf(catalogue.find(e => e.id === id), source);

export const FIRST_ID = 2, LAST_ID = 17;
export const ZIGZAG = [20, 70, 10, 80, 30, 60, 15, 75, 25, 65, 5, 85, 35, 55, 40, 90];
export const YANG_IDS = [];
for (let id = FIRST_ID; id <= LAST_ID; id++) YANG_IDS.push(firstImage(id));
export const CHEN_ID = firstImage(3, 'chen');        // the Chen photograph beside yang-006 on entry 3
export const ELBOW = 'left_elbow';

/** Elbow angle (degrees from rest) of the fixture estimate for an image id. */
export function angleOf(imageId) {
  const i = YANG_IDS.indexOf(imageId);
  if (i >= 0) return ZIGZAG[i];
  if (imageId === CHEN_ID) return 45;
  if (imageId === 'yang-001') return 50;
  throw new Error(`no fixture angle for ${imageId}`);
}
const translationOf = imageId => [0.03 * (imageId.length + angleOf(imageId) % 7), 0, 0];

/** One valid published pose text for `imageId`. Distinct elbow angle and pelvis position per image. */
export function poseTextFor(imageId) {
  const deltas = {[ELBOW]: axisAngle([1, 0, 0], angleOf(imageId))};
  const pose = makePose(deltas, {imageId});
  const translation = translationOf(imageId);
  pose.root.translation = translation;
  const positions = fkPositions(Object.fromEntries(Object.entries(pose.joints).map(([k, v]) => [k, v.rotation])), {rotation: [0, 0, 0, 1], translation});
  for (const name of Object.keys(pose.landmarks)) pose.landmarks[name] = positions.get(name).toArray().map(v => Math.round(v * 1e4) / 1e4);
  return JSON.stringify(pose);
}
export const sha256 = text => createHash('sha256').update(text).digest('hex');

/**
 * Serve the repo tree with an index over `ids` (default: every fixture image). `corrupt` lists image ids whose file is
 * replaced by invalid JSON (its index hash is that of the corrupt bytes, so it fails validation and not the hash check).
 */
export async function serveS6({ids = [...new Set([...YANG_IDS, CHEN_ID, 'yang-001'])], corrupt = []} = {}) {
  const texts = new Map(ids.map(id => [id, corrupt.includes(id) ? '{"not":"a pose"}' : poseTextFor(id)]));
  const index = JSON.stringify({schema: 'yang-form/pose-estimate-index', schemaVersion: 1, estimates: ids.map(id => ({imageId: id, file: `${id}.json`, sha256: sha256(texts.get(id))}))});
  const files = {'/assets/pose-estimates/index.json': index, ...Object.fromEntries(ids.map(id => [`/assets/pose-estimates/${id}.json`, texts.get(id)]))};
  return serveSite({estimates: [], files});
}

const SHIM = `(() => {
  if (self.crypto && crypto.subtle) return;
  let n = 0; const pending = new Map();
  window.__s6shaDone = (id, hex) => { const done = pending.get(id); pending.delete(id); done(Uint8Array.from(hex.match(/../g), h => parseInt(h, 16)).buffer); };
  Object.defineProperty(crypto, 'subtle', {configurable: true, value: {digest: (algorithm, data) => new Promise(resolve => {
    if (String(algorithm.name ?? algorithm).toUpperCase() !== 'SHA-256') throw new Error('shim: only SHA-256');
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const id = ++n; pending.set(id, resolve); __s6sha(JSON.stringify({id, b64: btoa(binary)}));
  })}});
})();
// Whether a transition was ever active, and how often the state changed kind, from the first frame of the page.
window.__everActive = false;
(function watch() { try { if (window.__explorer?.state.transition.active) window.__everActive = true; } catch {} requestAnimationFrame(watch); })();`;

/**
 * Open the fixture site with the explorer hook, a SHA-256 binding (node:crypto answers; nothing is hand-rolled) and optional
 * reduced-motion emulation, settle the avatar, scroll the panel into view and choose the Yang source.
 * `hash` is the start-up hash. `yang: false` leaves the default Drawings source.
 */
export async function openS6Page(site, {hash = `#move=${FIRST_ID + 1}`, reducedMotion = false, yang = true} = {}) {
  const page = await openPage();
  try {
    page.ws.addEventListener('message', event => {
      const m = JSON.parse(event.data);
      if (m.method !== 'Runtime.bindingCalled' || m.params.name !== '__s6sha') return;
      const {id, b64} = JSON.parse(m.params.payload);
      page.send('Runtime.evaluate', {expression: `__s6shaDone(${id}, '${createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex')}')`}).catch(() => {});
    });
    await page.send('Runtime.addBinding', {name: '__s6sha'});
    await page.send('Page.addScriptToEvaluateOnNewDocument', {source: SHIM});
    if (reducedMotion) await page.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
    await page.navigate(`${site.base}?explorer-test=1${hash}`);
    await page.waitFor("window.__explorer && window.__explorer.state.rig !== 'pending'", {what: 'window.__explorer with a settled rig', timeout: 15000});
    await page.evaluate("document.getElementById('model-view').scrollIntoView({behavior: 'instant', block: 'start'})");
    await page.waitFor('__explorer.state.visible === true && __explorer.state.renderCount > 0', {what: 'the panel to render'});
    if (yang) await chooseSource(page, 'yang');
    return page;
  } catch (error) { await page.close(); throw error; }
}

export const STATE = '__explorer.state';
/** Wait until `renderCount` has not changed for `quietMs` of page time (bounded), so that a late first paint cannot land in an idle window. */
export async function stable(page, quietMs = 1000, timeout = 15000) {
  const end = Date.now() + timeout;
  let last = await page.evaluate('__explorer.state.renderCount'), since = Date.now();
  while (Date.now() - since < quietMs) {
    if (Date.now() > end) throw new Error('renderCount never settled');
    await page.quiet(100);
    const now = await page.evaluate('__explorer.state.renderCount');
    if (now !== last) { last = now; since = Date.now(); }
  }
}
/**
 * Start a navigation page-side (`begin`, a JS statement) and run `script` (an async function body returning a value) in the first
 * animation frame where the driver is running with lo < progress < hi. Resolves to its result, or null if the transition ended
 * first (a loaded sidecar can skip the whole window); the caller restores the start state and retries.
 */
export const atMidHop = (page, {begin, script, lo = 0.1, hi = 0.9, timeout = 9000}) => page.evaluate(`new Promise(resolve => {
  const t0 = performance.now();
  ${begin};
  (function poll() {
    const s = __explorer.state.transition, waited = performance.now() - t0;
    if (s.active && s.progress > ${lo} && s.progress < ${hi}) return (async () => { ${script} })().then(resolve);
    if (waited > ${timeout} || (!s.active && waited > 200)) return resolve(null);
    requestAnimationFrame(poll);
  })();
})`);
/** Choose a source the way a user does (an image change on the current entry) and wait for the page to show it. */
export async function chooseSource(page, source) {
  await page.evaluate(`document.querySelector('#source-filters [data-source="${source}"]').click()`);
  await page.waitFor(`document.getElementById('pose-image').dataset.source === '${source}'`, {what: `source ${source}`});
}
export const displayedImage = page => page.evaluate("document.getElementById('pose-image').dataset.imageId");
/** Wait until the hook shows an applied estimate for `imageId`, no transition running. */
export const settled = (page, imageId) => page.waitFor(`(() => { const s = __explorer.state; return s.pose.kind === 'estimate' && s.pose.imageId === '${imageId}' && !s.transition.active; })()`, {what: `estimate ${imageId} applied`, timeout: 15000});
/** Wait until the rig is neutral and idle. */
export const settledNeutral = page => page.waitFor("(() => { const s = __explorer.state; return s.pose.kind === 'neutral' && !s.transition.active; })()", {what: 'neutral rig'});
export const go = (page, id) => page.evaluate(`location.hash = 'move=${id}'`);

/**
 * Page-side per-frame recorder: window.__rec gets one entry per animation frame until `stopRecording`. `t` is performance.now() when
 * the callback runs (the driver's own clock), not the rAF timestamp, which lags it whenever the main thread was busy.
 */
export const startRecording = page => page.evaluate(`(() => {
  window.__rec = []; window.__recOn = true; const generation = window.__recGen = (window.__recGen ?? 0) + 1;   // a restart must not revive the old chain
  const rig = () => __explorer.rig;
  (function tick() {
    if (!window.__recOn || window.__recGen !== generation) return;
    const s = __explorer.state, el = id => document.getElementById(id);
    window.__rec.push({t: performance.now(), active: s.transition.active, progress: s.transition.progress, hopIndex: s.transition.hopIndex, hopsTotal: s.transition.hopsTotal, to: s.transition.to,
      kind: s.pose.kind, imageId: s.pose.imageId ?? null, renderCount: s.renderCount, settling: !!s.lag?.settling, label: s.label, provenance: el('model-provenance').textContent, detail: el('model-provenance-detail')?.textContent ?? '',
      readout: s.readout, angle: __explorer.jointAngle('${ELBOW}'), pelvis: rig().worldPositionOf('pelvis'), marker: s.marker?.visible ? s.marker.position : null, selected: s.selectedJoint,
      selectedPosition: s.selectedJoint ? rig().worldPositionOf(s.selectedJoint) : null, sliders: [el('elbow-angle').disabled, el('stance-angle').disabled], note: el('slider-note').hidden});
    requestAnimationFrame(tick);
  })();
})()`);
export const stopRecording = page => page.evaluate('(() => { window.__recOn = false; return window.__rec; })()');
/** Poll until the recorder has seen `predicate(frame)`; the expression runs page-side over the latest frame. */
export const waitFrame = (page, predicate, what) => page.waitFor(`(() => { const r = window.__rec; return !!r.length && (${predicate})(r[r.length - 1]); })()`, {what, timeout: 15000, interval: 10});

/** Angle the fixture route implies at eased progress p: piecewise-linear between the keyframe angles at k/N. */
export function expectedAngle(angles, p) {
  const n = angles.length - 1, h = Math.min(n - 1, Math.floor(p * n)), t = p * n - h;
  return angles[h] + (angles[h + 1] - angles[h]) * t;
}
export { SITE_URL };
