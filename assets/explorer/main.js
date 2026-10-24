// Composition root: builds the scene, loads the avatar, wires the controls and owns the state object.
// The only explorer module with side effects at import. It listens for yang:image-shown and never changes the catalogue.
import {createScene} from './scene.js';
import {createFallbackRig, loadAvatar} from './rig.js';
import {bindControls} from './controls.js';
import {bendQuaternion, jointAngleDegrees} from './retarget.js';
import {presetPosition, detectPreset} from './presets.js';
import {TEXT} from './provenance.js';
import {loadIndex, fetchEstimate, readLocalFile, validatePose} from './poses.js';
import {applyPose, checkLeftRight} from './retarget.js';
import {HOP_MS, CAP_MS, MAX_KEYFRAMES, keyframeSequence, sequenceIndexOf, planRoute, createDriver} from './transition.js';

const host = document.getElementById('model-view'), status = document.getElementById('model-status');
const css = getComputedStyle(document.documentElement), colour = name => css.getPropertyValue(name).trim();

const idle = () => ({active: false, from: null, to: null, progress: 0, hopsTotal: 0, hopIndex: 0, skipped: 0, hopMs: HOP_MS, capMs: CAP_MS, maxKeyframes: MAX_KEYFRAMES});
const state = {
  renderer: 'pending', rig: 'pending', camera: {preset: 'three-quarter'},
  checks: {elbow: 0, crouch: 0, skeleton: false}, selectedJoint: null,
  displayedImage: null, availableEstimate: null, showNeutral: false, indexed: false, pose: {kind: 'neutral'}, transition: idle(), poseError: null, renderCount: 0,
};

const $ = id => document.getElementById(id), forced = new URLSearchParams(location.search).get('explorer-test');
// The still path (PE-23, PE-24). The <img> is created only here, so a normal load never requests the PNG (PE-28).
function showStill() {
  host.closest('.model-panel').dataset.still = ''; status.hidden = false; status.textContent = TEXT[state.renderer]; // TEXT.failed or TEXT.none
  const img = Object.assign(new Image(), {id: 'model-still', alt: TEXT.stillAlt}); img.setAttribute('src', 'assets/model/avatar-neutral.png'); host.append(img);
}
let timer = 0, view = null;
const fail = () => { state.renderer = 'failed'; showStill(); ui.sync(); };
try { // probe first: three.js logs console.error before it throws, and PE-24 allows none
  if (forced === 'no-webgl' || !document.createElement('canvas').getContext('webgl2')) throw new Error('WebGL2 is unavailable or forced off');
  view = createScene({
    host, colour,
    onRender: () => { state.renderCount++; },
    onContextChange: kind => {
      if (kind === 'lost') { state.renderer = 'lost'; status.hidden = false; status.textContent = TEXT.lost; driver.finish(); timer = setTimeout(fail, 5000); } // PE-56: complete to the target, no frames
      else if (state.renderer === 'lost') { clearTimeout(timer); state.renderer = 'webgl'; status.hidden = true; view.requestRender(); }
    },
  });
} catch (error) { console.info(`3D view unavailable: ${error.message}`); }
if (!view) {
  state.renderer = 'none'; showStill(); $('model-label').textContent = TEXT.still; $('model-provenance').textContent = TEXT.neutral;
  if (forced === '1' || forced === 'no-webgl') window.__explorer = Object.freeze({state: {...state, label: TEXT.still}});
  await new Promise(() => {}); // nothing more to wire; the catalogue is site.js's and keeps working
}
const {requestRender} = view;
state.renderer = 'webgl';
// A drag starts as 'custom'; when it ends the camera is compared with the presets, so dragging back onto one re-selects it.
// Never the controls' change event: it also fires on programmatic updates (spec PE-10).
const settlePreset = () => { state.camera.preset = detectPreset(view.camera.position.toArray()); ui.sync(); };
view.controls.addEventListener('start', () => { state.camera.preset = 'custom'; ui.sync(); });
view.controls.addEventListener('end', settlePreset);

let rig = createFallbackRig(view.scene, colour); const fallback = rig; // state.rig stays 'pending' until the avatar load settles


// Estimates are always on (operator decision, ADR-0004): the displayed image's reviewed estimate is applied as soon as it is known.
// `seq` tags each refresh so a slower, older one can never overwrite a newer pose.
const indexPromise = loadIndex(), fetched = new Map(), file = () => $('pose-file');
let seq = 0;
const settle = () => { requestRender(); ui.sync(); };
const toNeutral = () => {
  endMotion();
  if (rig.kind === 'avatar') { rig.resetToRest(); state.checks.elbow = 0; state.checks.crouch = 0; }
  state.pose = {kind: 'neutral'};
};
const reject = errors => {
  state.poseError = TEXT.rejected(errors[0].message); console.warn(state.poseError); settle();
  return {ok: false, errors};
};
const drive = file => { const {locals, rootTranslation} = applyPose(rig.rest, file); for (const [name, q] of locals) rig.setLocal(name, q); rig.setRootTranslation(rootTranslation); };
function show(pose) {
  endMotion(); rig.resetToRest(); drive(pose.file);
  Object.assign(state.checks, {elbow: 0, crouch: 0}); state.pose = pose; state.poseError = null; settle();
}
// The S6 driver owns the only frame loop. `route` = {start, startId, from, fromMove, at, end} while a transition is pending or running.
let route = null, estimates = null;
const endMotion = () => { driver.cancel(); route = null; state.transition = idle(); };
const driver = createDriver({
  requestFrame: requestAnimationFrame.bind(window), cancelFrame: cancelAnimationFrame.bind(window), now: () => performance.now(),
  onFrame: ({pose, hopIndex}, progress) => { drive(pose); Object.assign(state.transition, {progress, hopIndex}); requestRender(); }, // no ui.sync: aria-live stays quiet (PE-51)
  onArrive: () => show(route.end),
});
async function estimate(id) {
  if (!fetched.has(id)) fetched.set(id, fetchEstimate(undefined, estimates.get(id)));
  const result = await fetched.get(id), errors = !result.ok ? result.errors : checkLeftRight(rig.rest, result.pose).errors;
  if (errors.length) fetched.delete(id);
  return {file: result.pose, errors};
}
// PE-19: a pose never outlives its image. The stale pose is dropped in the same task; the new one follows once its file is checked.
async function refreshEstimate() {
  const ticket = ++seq, image = state.displayedImage;
  if (state.pose.kind !== 'neutral' && (state.showNeutral || state.pose.origin === 'local' || state.pose.imageId !== image?.imageId)) { toNeutral(); settle(); }
  const {entries} = await indexPromise, entry = entries?.get(image?.imageId); estimates = entries;
  if (!state.indexed && entries?.size) { state.indexed = true; ui.sync(); }
  if (ticket !== seq) return;
  state.availableEstimate = entry ? image.imageId : null;
  if (!entry || state.showNeutral || rig.kind !== 'avatar') { if (state.pose.kind !== 'neutral') toNeutral(); return settle(); }
  if (state.pose.kind === 'estimate') return settle();
  const {file, errors} = await estimate(image.imageId);
  if (ticket !== seq) return;
  if (errors.length) return reject(errors);
  show({kind: 'estimate', origin: 'published', imageId: image.imageId, imageLabel: image.label, file});
}
// A user navigation between two reviewed estimates (PE-45): fetch the route, then drive it. Anything else snaps through refreshEstimate.
const catalogue = {};
async function navigate(prev) {
  const image = state.displayedImage, from = state.pose, live = driver.current();
  if (state.showNeutral || rig.kind !== 'avatar' || !estimates?.has(image.imageId)
    || !(from.kind === 'interpolated' || from.kind === 'estimate' && from.origin === 'published')) return refreshEstimate();
  const ticket = ++seq, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; // reduced motion: same fetch and labels, but a snap (PE-49)
  let r = route ?? {start: from.file, startId: from.imageId, fromMove: prev.moveId};
  if (live) { // PE-52: carry on from the frame on screen, through the end of the current hop that lies nearer the new target
    const cur = catalogue.sequence, h = live.hopIndex, a = h ? r.at[h - 1] : r.from, b = r.at[h], t = sequenceIndexOf(cur, image.moveId);
    const e = Math.abs(t - b) <= Math.abs(t - a) ? b : a, d = Math.sign(t - e) || Math.sign(e - (e === b ? a : b));
    r = {start: live.pose, from: e - d};
  }
  route = r; driver.cancel();
  state.pose = {kind: 'interpolated', fromImageId: r.startId, toImageId: image.imageId};
  state.transition = {...idle(), active: true, from: r.startId ?? state.transition.from, to: image.imageId};
  ui.sync();
  if (!reduce && catalogue.source !== image.source) {
    try { catalogue.sequence = keyframeSequence(await (catalogue.data ??= fetch(new URL('../catalogue.json', import.meta.url)).then(x => x.json())), image.source); catalogue.source = image.source; }
    catch (error) { console.warn(`Route unavailable: ${error.message}`); catalogue.source = catalogue.data = null; } // a rejected fetch is not cached for the session
    if (ticket !== seq) return;
    if (catalogue.source !== image.source) return refreshEstimate();
  }
  const sequence = catalogue.sequence, to = reduce ? 0 : sequenceIndexOf(sequence, image.moveId), at = r.from ?? (reduce ? 0 : sequenceIndexOf(sequence, r.fromMove));
  const plan = reduce ? {keyframes: [image.imageId], skipped: 0} : planRoute(sequence, at, to, estimates, {startImageId: r.startId}), ids = plan.keyframes;
  if (!ids.length) return refreshEstimate();
  ids[ids.length - 1] = image.imageId; // arrival always uses the displayed image, whatever the keyframe rule says
  const step = Math.sign(to - at); let i = at;
  Object.assign(state.transition, {hopsTotal: ids.length, skipped: plan.skipped}); ui.sync();
  const loaded = await Promise.all(ids.map(estimate));
  if (ticket !== seq) return;
  const last = loaded.length - 1, files = [];
  r.at = []; r.from = at;
  loaded.forEach(({file, errors}, k) => {
    if (!reduce) do i += step; while (sequence[i].imageId !== ids[k] && i !== to);
    if (!errors.length) { files.push(file); r.at.push(i); } else if (k < last) console.warn(`${ids[k]}: ${errors[0].message}`);
  });
  if (loaded[last].errors.length) { toNeutral(); return reject(loaded[last].errors); }
  r.end = {kind: 'estimate', origin: 'published', imageId: image.imageId, imageLabel: image.label, file: files[files.length - 1]};
  state.transition.hopsTotal = files.length; ui.sync();
  driver.start([r.start, ...files]);
  if (reduce || state.renderer !== 'webgl') driver.finish(); // context lost while loading: land on the target without frames
}
function loadResult(result, origin, imageLabel) {
  if (rig.kind !== 'avatar') return reject([{code: 'E_RIG', path: '', message: 'The avatar is not loaded.'}]);
  const bad = !result.ok ? result.errors : origin === 'published' ? checkLeftRight(rig.rest, result.pose).errors : [];
  if (bad.length) return reject(bad);
  seq++; // abandon any pending refresh
  const image = state.displayedImage, id = result.pose.imageId;
  show({kind: 'estimate', origin, imageId: id, imageLabel: imageLabel ?? (image?.imageId === id ? image.label : undefined), file: result.pose});
  return {ok: true};
}
const onImage = detail => {
  if (!detail?.imageId) return;
  const prev = state.displayedImage, changed = prev?.imageId !== detail.imageId;
  state.displayedImage = {imageId: detail.imageId, label: detail.label, moveId: detail.moveId, ordinal: detail.ordinal, source: detail.source};
  if (changed) { state.poseError = null; if (prev && prev.moveId !== detail.moveId) navigate(prev); else refreshEstimate(); }
};
// site.js selects its first image before this module runs, so the first event is missed: read the DOM, then listen.
document.addEventListener('yang:image-shown', event => onImage(event.detail));
{ const d = $('pose-image').dataset; onImage(d.imageId && {imageId: d.imageId, label: d.label, moveId: Number(d.moveId), ordinal: Number(d.ordinal), source: d.source}); }

const bendBoth = (names, degrees) => { for (const name of names) { const q = bendQuaternion(rig.rest, name, degrees); if (q) rig.setLocal(name, q); } };
const actions = {
  setPreset(name) {
    const position = presetPosition(name); if (!position) return;
    view.setCameraPosition(position); state.camera.preset = name; ui.sync();
  },
  orbit(angle) { view.orbit(angle); settlePreset(); },
  zoom(factor) { view.zoom(factor); settlePreset(); },
  // Unknown names are ignored. A bone the current rig lacks stays selected, so the choice survives the avatar loading.
  selectJoint(name) {
    if (name !== null && !ui.label(name)) return;
    state.selectedJoint = name; rig.setMarker(name); requestRender(); ui.sync();
  },
  hasJoint: name => rig.rest.has(name),
  jointAngle: name => (rig.rest.has(name) ? jointAngleDegrees(rig.rest.get(name).local, rig.localOf(name)) : null),
  setElbow(angle) { if (state.pose.kind !== 'neutral') return; state.checks.elbow = angle; bendBoth(['left_elbow', 'right_elbow'], -angle); requestRender(); ui.sync(); },
  setCrouch(angle) {
    if (rig.kind !== 'avatar' || state.pose.kind !== 'neutral') return;
    state.checks.crouch = angle;
    for (const side of ['left', 'right']) { bendBoth([`${side}_hip`], -angle); bendBoth([`${side}_knee`], angle * 2); bendBoth([`${side}_ankle`], -angle); }
    rig.setRootTranslation([0, -.8 * (1 - Math.cos(angle * Math.PI / 180)), 0]);
    requestRender(); ui.sync();
  },
  setShowNeutral(on) { state.showNeutral = on; ui.sync(); refreshEstimate(); },
  async openPoseFile(chosen) { loadResult(await readLocalFile(chosen), 'local'); file().value = ''; },
  setSkeleton(show) { if (rig.kind !== 'avatar') return; state.checks.skeleton = show; rig.setSkeletonVisible(show); requestRender(); ui.sync(); },
  reset() {
    view.resetCamera(); state.camera.preset = 'three-quarter';
    // The fallback rig has always reset only the camera; the avatar resets every bone and both checks.
    if (rig.kind === 'avatar') { toNeutral(); state.checks.skeleton = false; rig.setSkeletonVisible(false); }
    state.showNeutral = false; state.poseError = null; file().value = '';
    settle(); refreshEstimate();
  },
};
const ui = bindControls(document, actions, () => state);
ui.sync();

if (new URLSearchParams(location.search).get('explorer-test') === '1') {
  // Read-only test hook, absent from production URLs. State is a snapshot; the rest is for browser checks.
  const bones = () => Object.fromEntries(rig.jointNames.map(name => [name, {quaternion: rig.localOf(name), position: rig.worldPositionOf(name)}]));
  window.__explorer = Object.freeze({
    get state() {
      return structuredClone({...state, ...rig.visibility(), bones: bones(), cameraPosition: view.camera.position.toArray(), label: document.getElementById('model-label').textContent, fallbackVisible: fallback.isVisible(), visible: view.isVisible(),
        readout: document.getElementById('joint-readout').textContent, provenance: document.getElementById('model-provenance').textContent, marker: rig.markerState()});
    },
    get renderer() { return view.renderer; }, camera: view.camera, controls: view.controls,
    get rig() { return rig; },
    actions: Object.freeze({...actions}),
    jointAngle: name => jointAngleDegrees(rig.rest.get(name).local, rig.localOf(name)),
    loadPoseObject: (object, {origin = 'local', imageLabel} = {}) => loadResult(validatePose(object, {origin}), origin, imageLabel),
  });
}

status.hidden = true;
try {
  const avatar = await loadAvatar(view.scene, new URL('../model/archive-avatar.glb', import.meta.url).href, colour);
  rig.setVisible(false); rig.setMarker(null); rig = avatar; state.rig = 'avatar'; rig.setMarker(state.selectedJoint);
  ui.sync(); requestRender(); refreshEstimate();
} catch (error) {
  // A usable joint rig remains available if the avatar asset cannot be fetched.
  state.rig = 'fallback-rig'; ui.sync();
  console.error('Avatar could not be loaded', error);
}
