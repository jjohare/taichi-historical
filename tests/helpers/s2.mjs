// Slice S2 page-side expressions and constants (PE-10 to PE-17). The assumed hook/DOM contract lives here, in one place:
//   presets   : <button>s inside the role=group labelled "Camera presets", visible text from PRESET_LABELS, aria-pressed
//   joints    : native <select id="joint-select">, "None" has an empty or "none" value; options carry bone names as values
//   readout   : #joint-readout; provenance: #model-provenance, #model-provenance-detail
//   hook      : __explorer.state.camera.preset, .selectedJoint, .pose.kind and .marker = {visible, position:[x,y,z], colour, depthTest}
export const TARGET = [0, 0.95, 0];
export const PRESET_LABELS = {front: 'Front', side: 'Side (left)', back: 'Back', 'three-quarter': 'Three-quarter', top: 'Top'};
export const PRESET_POSITIONS = {
  'three-quarter': [1.9, 1.45, 2.7], front: [0, 1.45, 3.3015], side: [3.3015, 1.45, 0], back: [0, 1.45, -3.3015], top: [0, 4.2765, 0.2910],
};
export const NEUTRAL_TEXT = 'Illustrative avatar — not this movement';

/** Page-side: accessible name of an element from aria-label or aria-labelledby. */
const NAME_OF = `(el => el.getAttribute('aria-label') ?? (el.getAttribute('aria-labelledby') || '').split(/\\s+/).map(i => document.getElementById(i)?.textContent ?? '').join(' ').trim())`;
export const PRESET_GROUP = `(() => [...document.querySelectorAll('[role="group"]')].find(g => ${NAME_OF}(g) === 'Camera presets'))()`;

/** Preset buttons in DOM order: [{label, pressed, tag, disabled}]. */
export const PRESET_BUTTONS = `(() => { const g = ${PRESET_GROUP}; if (!g) throw new Error('no role=group labelled "Camera presets"'); return [...g.children].flatMap(function walk(n) { return n.tagName === 'BUTTON' ? [n] : [...n.children].flatMap(walk); }).map(b => ({label: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), tag: b.tagName, disabled: b.disabled})); })()`;
export const clickPreset = label => `(() => { const g = ${PRESET_GROUP}; const b = [...g.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) throw new Error('no preset button ' + ${JSON.stringify(label)}); b.click(); })()`;
export const focusPreset = label => `(() => { const g = ${PRESET_GROUP}; const b = [...g.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); b.focus(); return document.activeElement === b; })()`;

export const TARGET_NOW = `__explorer.controls.target.toArray()`;
export const PRESET_STATE = `__explorer.state.camera.preset`;
export const renderCount = page => page.evaluate('__explorer.state.renderCount');

/** Choose a joint in the native select the way a user does (value + change). */
export const selectJoint = value => `(() => { const s = document.getElementById('joint-select'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', {bubbles: true})); return s.value; })()`;
export const readout = `document.getElementById('joint-readout').textContent.trim()`;
export const provenance = `(() => ({label: document.getElementById('model-label').textContent, text: document.getElementById('model-provenance')?.textContent.trim()}))()`;

/** The value of the "None" option, whatever the implementation chose: the option with an empty/none value or label "None". */
export const NONE_VALUE = `(() => { const o = [...document.getElementById('joint-select').options].find(o => o.textContent.trim() === 'None'); return o ? o.value : null; })()`;

/** Resolve a CSS colour string (or 0xRRGGBB number) to [r,g,b] in the page, so hex and rgb() forms compare. */
export const RGB_OF = `(c => { const e = document.createElement('span'); e.style.color = typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c; document.body.append(e); const m = getComputedStyle(e).color.match(/[\\d.]+/g).map(Number); e.remove(); return m.slice(0, 3); })`;

/** Settle load-time renders: renderCount unchanged for 1 s. */
export async function settle(page) {
  for (let last = -1, i = 0; i < 20; i++) {
    const now = await renderCount(page);
    if (now === last) return;
    last = now; await page.quiet(1000);
  }
  throw new Error('renderCount never settled');
}

export async function selectMove(page, id) {
  const before = await page.evaluate("document.getElementById('move-title').textContent");
  await page.evaluate(`location.hash = 'move=${id}'`);
  if (id !== 2) await page.waitFor(`document.getElementById('move-title').textContent !== ${JSON.stringify(before)}`, {what: `#move=${id} to render`});
  else await page.waitFor("location.hash === '#move=2'");
}
