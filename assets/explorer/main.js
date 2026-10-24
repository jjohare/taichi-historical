// Composition root: builds the scene, loads the avatar, wires the controls and owns the state object.
// The only explorer module with side effects at import. No catalogue event reaches it in this slice.
import {createScene} from './scene.js';
import {createFallbackRig, loadAvatar} from './rig.js';
import {bindControls} from './controls.js';
import {bendQuaternion, jointAngleDegrees} from './retarget.js';
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
view.controls.addEventListener('start', () => { state.camera.preset = 'custom'; });

let rig = createFallbackRig(view.scene, colour); // state.rig stays 'pending' until the avatar load settles


const bendBoth = (names, degrees) => { for (const name of names) { const q = bendQuaternion(rig.rest, name, degrees); if (q) rig.setLocal(name, q); } };
const actions = {
  orbit(angle) { state.camera.preset = 'custom'; view.orbit(angle); },
  zoom(factor) { state.camera.preset = 'custom'; view.zoom(factor); },
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

if (new URLSearchParams(location.search).get('explorer-test') === '1') {
  // Read-only test hook, absent from production URLs. State is a snapshot; the rest is for browser checks.
  const bones = () => Object.fromEntries(rig.jointNames.map(name => [name, {quaternion: rig.localOf(name), position: rig.worldPositionOf(name)}]));
  window.__explorer = Object.freeze({
    get state() {
      return structuredClone({...state, ...rig.visibility(), bones: bones(), cameraPosition: view.camera.position.toArray(), label: document.getElementById('model-label').textContent});
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
  rig.setVisible(false); rig = avatar; state.rig = 'avatar';
  ui.sync(); requestRender();
} catch (error) {
  // A usable joint rig remains available if the avatar asset cannot be fetched.
  state.rig = 'fallback-rig'; ui.sync();
  console.error('Avatar could not be loaded', error);
}
