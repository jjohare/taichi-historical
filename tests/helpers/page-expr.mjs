// Page-side expressions shared by the browser tests. They read only the documented hook surface (design §6).
export const SNAPSHOT = `(() => { const r = __explorer.rig; return Object.fromEntries(r.jointNames.map(n => [n, {q: r.localOf(n), p: r.worldPositionOf(n), rq: r.rest.get(n).local}])); })()`;
export const CAMERA = `__explorer.camera.position.toArray()`;
export const label = `document.getElementById('model-label').textContent`;

export const setSlider = (id, value) =>
  `(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${value}; el.dispatchEvent(new Event('input', {bubbles: true})); return el.value; })()`;
export const click = id => `document.getElementById(${JSON.stringify(id)}).click()`;
export const text = id => `document.getElementById(${JSON.stringify(id)}).textContent`;

/** Avatar mesh visibility and the skeleton helper, from the read-only hook snapshot (state.meshVisibility, state.skeletonVisible). */
export const SCENE_VISIBILITY = `(() => {
  const s = __explorer.state;
  if (typeof s.skeletonVisible !== 'boolean' || !s.meshVisibility) throw new Error('state.skeletonVisible / state.meshVisibility are missing from the hook');
  return {meshes: Object.entries(s.meshVisibility).map(([name, visible]) => ({name, visible})), skeleton: s.skeletonVisible};
})()`;

export const dot = (a, b) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (Math.hypot(...a) * Math.hypot(...b));
export const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
