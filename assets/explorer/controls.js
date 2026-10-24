// Binds the page's buttons, selects and sliders to actions, and reflects state back into the DOM.
// Receives an actions object rather than importing the scene or rig, so it can run against a stub.
import {provenanceFor} from './provenance.js';
import {JOINT_GROUPS, readoutText} from './joints.js';

export function bindControls(doc, actions, getState) {
  const $ = id => doc.getElementById(id);
  const presets = [...doc.querySelectorAll('[data-preset]')], select = $('joint-select');
  for (const button of presets) button.onclick = () => actions.setPreset(button.dataset.preset);
  for (const [group, joints] of JOINT_GROUPS) {
    const optgroup = doc.createElement('optgroup'); optgroup.label = group;
    for (const [name, label] of joints) { const option = doc.createElement('option'); option.value = name; option.textContent = label; optgroup.append(option); }
    select.append(optgroup);
  }
  select.onchange = () => actions.selectJoint(select.value || null);
  $('orbit-left').onclick = () => actions.orbit(-Math.PI / 8);
  $('orbit-right').onclick = () => actions.orbit(Math.PI / 8);
  $('zoom-in').onclick = () => actions.zoom(.85);
  $('zoom-out').onclick = () => actions.zoom(1.15);
  $('reset-view').onclick = () => actions.reset();
  $('elbow-angle').oninput = e => actions.setElbow(Number(e.target.value));
  $('stance-angle').oninput = e => actions.setCrouch(Number(e.target.value));
  $('show-skeleton').onchange = e => actions.setSkeleton(e.target.checked);
  return {
    sync() {
      const state = getState(), {checks, rig, pose, camera, selectedJoint} = state, {tag, text, detail} = provenanceFor(pose, {rig});
      for (const button of presets) button.setAttribute('aria-pressed', String(button.dataset.preset === camera.preset));
      $('elbow-angle').value = checks.elbow; $('joint-value').textContent = `${checks.elbow}°`;
      $('stance-angle').value = checks.crouch; $('stance-value').textContent = `${checks.crouch}°`;
      $('show-skeleton').checked = checks.skeleton;
      $('avatar-controls').hidden = rig !== 'avatar';
      if (tag) $('model-label').textContent = tag;
      $('model-provenance').textContent = text; $('model-provenance-detail').textContent = detail;
      select.value = selectedJoint ?? '';
      // Only bones the current rig has can be inspected (the fallback rig names its joints differently).
      for (const option of select.options) option.disabled = option.value !== '' && !actions.hasJoint(option.value);
      const degrees = selectedJoint ? actions.jointAngle(selectedJoint) : null;
      const readout = degrees === null ? '' : readoutText(selectedJoint, degrees);
      if ($('joint-readout').textContent !== readout) $('joint-readout').textContent = readout; // unchanged text must not re-announce
    },
  };
}
