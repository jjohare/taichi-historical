// Composition root: builds the scene, loads the avatar, wires the controls and owns the state object.
// The only explorer module with side effects at import. No catalogue event reaches it in this slice.
import {createScene} from './scene.js';
import {createFallbackRig, loadAvatar} from './rig.js';
import {bindControls} from './controls.js';
import {bendQuaternion, jointAngleDegrees} from './retarget.js';
import {presetPosition, detectPreset} from './presets.js';
import {JOINT_LABELS} from './joints.js';
import {TEXT} from './provenance.js';

const host = document.getElementById('model-view'), status = document.getElementById('model-status');
const css = getComputedStyle(document.documentElement), colour = name => css.getPropertyValue(name).trim();

const state = {
  renderer: 'pending', rig: 'pending', camera: {preset: 'three-quarter'},
  checks: {elbow: 0, crouch: 0, skeleton: false}, selectedJoint: null,
  displayedImage: null, availableEstimate: null, pose: {kind: 'neutral'}, poseError: null, renderCount: 0,
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
  setElbow(angle) { state.checks.elbow = angle; bendBoth(['left_elbow', 'right_elbow'], -angle); requestRender(); ui.sync(); },
  setCrouch(angle) {
    if (rig.kind !== 'avatar') return;
    state.checks.crouch = angle;
    for (const side of ['left', 'right']) { bendBoth([`${side}_hip`], -angle); bendBoth([`${side}_knee`], angle * 2); bendBoth([`${side}_ankle`], -angle); }
    rig.setRootTranslation([0, -.8 * (1 - Math.cos(angle * Math.PI / 180)), 0]);
    requestRender(); ui.sync();
  },
  setSkeleton(show) { if (rig.kind !== 'avatar') return; state.checks.skeleton = show; rig.setSkeletonVisible(show); requestRender(); ui.sync(); },
  reset() {
    view.resetCamera(); state.camera.preset = 'three-quarter';
    // The fallback rig has always reset only the camera; the avatar resets every bone and both checks.
    if (rig.kind === 'avatar') { rig.resetToRest(); Object.assign(state.checks, {elbow: 0, crouch: 0, skeleton: false}); rig.setSkeletonVisible(false); }
    requestRender(); ui.sync();
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
  });
}

status.hidden = true;
try {
  const avatar = await loadAvatar(view.scene, new URL('../model/archive-avatar.glb', import.meta.url).href, colour);
  rig.setVisible(false); rig.setMarker(null); rig = avatar; state.rig = 'avatar'; rig.setMarker(state.selectedJoint);
  ui.sync(); requestRender();
} catch (error) {
  // A usable joint rig remains available if the avatar asset cannot be fetched.
  state.rig = 'fallback-rig'; ui.sync();
  console.error('Avatar could not be loaded', error);
}
