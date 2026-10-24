// Page-side expressions shared by the browser tests. They read only the documented hook surface (design §6).
export const SNAPSHOT = `(() => { const r = __explorer.rig; return Object.fromEntries(r.jointNames.map(n => [n, {q: r.localOf(n), p: r.worldPositionOf(n), rq: r.rest.get(n).local}])); })()`;
export const CAMERA = `__explorer.camera.position.toArray()`;
export const label = `document.getElementById('model-label').textContent`;

export const setSlider = (id, value) =>
  `(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${value}; el.dispatchEvent(new Event('input', {bubbles: true})); return el.value; })()`;
export const click = id => `document.getElementById(${JSON.stringify(id)}).click()`;
export const text = id => `document.getElementById(${JSON.stringify(id)}).textContent`;

/** Avatar meshes and the skeleton helper. Needs `__explorer.scene` (see the report: the hook must expose it). */
export const SCENE_VISIBILITY = `(() => {
  const scene = __explorer.scene;
  if (!scene) throw new Error('__explorer.scene is not exposed; PE-05 and PE-07 need it');
  const avatar = scene.getObjectByName('ArchiveAvatar');
  const meshes = []; avatar.traverse(o => { if (o.isMesh) meshes.push({name: o.name, visible: o.visible}); });
  const helper = scene.children.find(c => c.isSkeletonHelper);
  return {meshes, skeleton: helper ? helper.visible : null};
})()`;

// |cos| of half the angle between two rotations. Normalised, because the GLB's float32-derived quaternions are not exactly unit length.
export const dot = (a, b) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) / (Math.hypot(...a) * Math.hypot(...b));
export const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
