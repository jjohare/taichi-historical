// Binds the page's buttons and sliders to actions, and reflects state back into the DOM.
// Receives an actions object rather than importing the scene or rig, so it can run against a stub.
import {provenanceFor} from './provenance.js';

export function bindControls(doc, actions, getState) {
  const $ = id => doc.getElementById(id);
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
      const {checks, rig} = getState(), {tag} = provenanceFor(getState());
      $('elbow-angle').value = checks.elbow; $('joint-value').textContent = `${checks.elbow}°`;
      $('stance-angle').value = checks.crouch; $('stance-value').textContent = `${checks.crouch}°`;
      $('show-skeleton').checked = checks.skeleton;
      $('avatar-controls').hidden = rig !== 'avatar';
      if (tag) $('model-label').textContent = tag;
    },
  };
}
