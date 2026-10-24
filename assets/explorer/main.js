// Composition root: builds the scene, loads the avatar, wires the controls and owns the state object.
// The only explorer module with side effects at import. It listens for yang:image-shown and never changes the catalogue.
import {createScene} from './scene.js';
import {createFallbackRig, loadAvatar} from './rig.js';
import {bindControls} from './controls.js';
import {bendQuaternion, jointAngleDegrees} from './retarget.js';
import {presetPosition, detectPreset} from './presets.js';
import {JOINT_LABELS} from './joints.js';
import {TEXT} from './provenance.js';
import {loadIndex, fetchEstimate, readLocalFile, validatePose} from './poses.js';
import {applyPose, checkLeftRight} from './retarget.js';

const host = document.getElementById('model-view'), status = document.getElementById('model-status');
const css = getComputedStyle(document.documentElement), colour = name => css.getPropertyValue(name).trim();

const state = {
  renderer: 'pending', rig: 'pending', camera: {preset: 'three-quarter'},
  checks: {elbow: 0, crouch: 0, skeleton: false}, selectedJoint: null,
  displayedImage: null, availableEstimate: null, showNeutral: false, pose: {kind: 'neutral'}, poseError: null, renderCount: 0,
};

const view = createScene({
  host, colour,
  onRender: () => { state.renderCount++; },
  onContextChange: kind => {
    if (kind !== 'lost') return;
    state.renderer = 'lost'; status.hidden = false; status.textContent = TEXT.lost;
  },
});
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
const $ = id => document.getElementById(id);
const settle = () => { requestRender(); ui.sync(); };
const toNeutral = () => {
  if (rig.kind === 'avatar') { rig.resetToRest(); state.checks.elbow = 0; state.checks.crouch = 0; }
  state.pose = {kind: 'neutral'};
};
const reject = errors => {
  state.poseError = TEXT.rejected(errors[0].message); console.warn(state.poseError); settle();
  return {ok: false, errors};
};
function show(pose) {
  const {locals, rootTranslation} = applyPose(rig.rest, pose.file);
  rig.resetToRest(); for (const [name, q] of locals) rig.setLocal(name, q); rig.setRootTranslation(rootTranslation);
  Object.assign(state.checks, {elbow: 0, crouch: 0}); state.pose = pose; state.poseError = null; settle();
}
// PE-19: a pose never outlives its image. The stale pose is dropped in the same task; the new one follows once its file is checked.
async function refreshEstimate() {
  const ticket = ++seq, image = state.displayedImage;
  if (state.pose.kind !== 'neutral' && (state.showNeutral || state.pose.origin === 'local' || state.pose.imageId !== image?.imageId)) { toNeutral(); settle(); }
  const entry = (await indexPromise).entries?.get(image?.imageId);
  if (ticket !== seq) return;
  state.availableEstimate = entry ? image.imageId : null;
  if (!entry || state.showNeutral || rig.kind !== 'avatar') { if (state.pose.kind !== 'neutral') toNeutral(); return settle(); }
  if (state.pose.kind === 'estimate') return settle();
  if (!fetched.has(image.imageId)) fetched.set(image.imageId, fetchEstimate(undefined, entry));
  const result = await fetched.get(image.imageId);
  if (ticket !== seq) return;
  const bad = !result.ok ? result.errors : checkLeftRight(rig.rest, result.pose).errors;
  if (bad.length) { fetched.delete(image.imageId); return reject(bad); }
  show({kind: 'estimate', origin: 'published', imageId: image.imageId, imageLabel: image.label, file: result.pose});
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
  const changed = state.displayedImage?.imageId !== detail.imageId;
  state.displayedImage = {imageId: detail.imageId, label: detail.label, moveId: detail.moveId, ordinal: detail.ordinal};
  if (changed) { state.poseError = null; refreshEstimate(); }
};
// site.js selects its first image before this module runs, so the first event is missed: read the DOM, then listen.
document.addEventListener('yang:image-shown', event => onImage(event.detail));
{ const d = $('pose-image').dataset; onImage(d.imageId && {imageId: d.imageId, label: d.label, moveId: Number(d.moveId), ordinal: Number(d.ordinal)}); }

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
    if (name !== null && !Object.hasOwn(JOINT_LABELS, name)) return;
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
