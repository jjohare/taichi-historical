// PE-10 (presets), PE-11 (no motion), PE-12 (keyboard access, automatable part).
import assert from 'node:assert/strict';
import {browserTest, withExplorer} from '../helpers/cdp.mjs';
import {click, dist} from '../helpers/page-expr.mjs';
import {PRESET_LABELS, PRESET_POSITIONS, TARGET, PRESET_BUTTONS, clickPreset, focusPreset, TARGET_NOW, PRESET_STATE, PRESET_GROUP, settle, renderCount} from '../helpers/s2.mjs';

const pressed = async page => (await page.evaluate(PRESET_BUTTONS)).filter(b => b.pressed === 'true').map(b => b.label);

browserTest('PE-10 five <button> presets in a group labelled "Camera presets", in the documented order', () =>
  withExplorer({}, async page => {
    const buttons = await page.evaluate(PRESET_BUTTONS);
    assert.deepEqual(buttons.map(b => b.label), ['Front', 'Side (left)', 'Back', 'Three-quarter', 'Top']);
    assert.ok(buttons.every(b => b.tag === 'BUTTON' && b.pressed !== null), 'each is a <button> with aria-pressed');
    assert.deepEqual(await pressed(page), ['Three-quarter'], 'the default view is Three-quarter');
  }));

for (const [name, label] of Object.entries(PRESET_LABELS)) {
  browserTest(`PE-10 clicking "${label}" places the camera at the design position, targets (0, 0.95, 0) and presses only that button`, () =>
    withExplorer({}, async page => {
      if (name === 'three-quarter') await page.evaluate(clickPreset('Front'));   // so that the click is a change
      await page.evaluate(clickPreset(label));
      assert.ok(dist(await page.evaluate('__explorer.camera.position.toArray()'), PRESET_POSITIONS[name]) < 1e-3, `${name} position`);
      assert.ok(dist(await page.evaluate(TARGET_NOW), TARGET) < 1e-6, 'target');
      assert.deepEqual(await pressed(page), [label]);
      assert.equal(await page.evaluate(PRESET_STATE), name);
    }));
}

browserTest('PE-10 an orbit button, a zoom button and a pointer drag each leave no preset pressed and state.camera.preset "custom"', () =>
  withExplorer({}, async page => {
    for (const action of ['orbit-left', 'orbit-right', 'zoom-in', 'zoom-out']) {
      await page.evaluate(clickPreset('Front'));
      assert.deepEqual(await pressed(page), ['Front']);
      await page.evaluate(click(action));
      assert.deepEqual(await pressed(page), [], `after ${action}`);
      assert.equal(await page.evaluate(PRESET_STATE), 'custom', `after ${action}`);
    }
    await page.evaluate(clickPreset('Front'));
    const box = await page.evaluate(`(() => { const c = document.querySelector('#model-view canvas'); c.scrollIntoView({block: 'center', behavior: 'instant'}); const r = c.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()`);
    const mouse = (type, dx, extra = {}) => page.send('Input.dispatchMouseEvent', {type, x: box.x + dx, y: box.y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra});
    await mouse('mousePressed', 0); for (const dx of [10, 30, 60]) await mouse('mouseMoved', dx); await mouse('mouseReleased', 60);
    await page.waitFor(`${PRESET_STATE} === 'custom'`, {what: 'a drag to mark the view custom'});
    assert.deepEqual(await pressed(page), []);
  }));

browserTest('PE-10 a programmatic controls.update() does not clear the pressed preset', () =>
  withExplorer({}, async page => {
    await page.evaluate(clickPreset('Back'));
    await page.evaluate('__explorer.controls.update(); __explorer.controls.dispatchEvent({type: "change"})');
    await page.quiet(200);
    assert.deepEqual(await pressed(page), ['Back']);
    assert.equal(await page.evaluate(PRESET_STATE), 'back');
  }));

browserTest('PE-11 no auto-rotation or damping; a preset costs at most 2 renders and the camera is then still for 2 s', () =>
  withExplorer({}, async page => {
    assert.equal(await page.evaluate('__explorer.controls.autoRotate'), false);
    assert.equal(await page.evaluate('__explorer.controls.enableDamping'), false);
    await settle(page);
    const before = await renderCount(page);
    await page.evaluate(clickPreset('Side (left)'));
    await page.waitFor(`__explorer.state.renderCount > ${before}`, {what: 'a render after the preset'});
    const camera = await page.evaluate('__explorer.camera.position.toArray()');
    await page.quiet(2000);
    assert.ok(dist(await page.evaluate('__explorer.camera.position.toArray()'), camera) < 1e-9, 'camera moved on its own');
    const used = (await renderCount(page)) - before;
    assert.ok(used >= 1 && used <= 2, `renders used: ${used}`);
  }));

browserTest('PE-11 under prefers-reduced-motion: reduce the same holds', () =>
  withExplorer({}, async page => {
    await page.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-motion', value: 'reduce'}]});
    assert.equal(await page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), true);
    await settle(page);
    const before = await renderCount(page);
    await page.evaluate(clickPreset('Top'));
    await page.waitFor(`__explorer.state.renderCount > ${before}`, {what: 'a render after the preset'});
    assert.ok(dist(await page.evaluate('__explorer.camera.position.toArray()'), PRESET_POSITIONS.top) < 1e-3, 'instant jump');
    const camera = await page.evaluate('__explorer.camera.position.toArray()');
    await page.quiet(2000);
    assert.ok(dist(await page.evaluate('__explorer.camera.position.toArray()'), camera) < 1e-9);
    assert.ok((await renderCount(page)) - before <= 2);
    assert.equal(await page.evaluate('__explorer.controls.autoRotate'), false);
  }));

const ORDER = ['Front', 'Side (left)', 'Back', 'Three-quarter', 'Top', ['orbit-left', 'orbit-right', 'zoom-in', 'zoom-out'], 'reset-view', 'joint-select', 'elbow-angle', 'stance-angle', 'show-skeleton'];

browserTest('PE-12 controls follow #move-title in DOM order: presets, orbit/zoom, reset, joint select, sliders, skeleton toggle', () =>
  withExplorer({}, async page => {
    const sequence = await page.evaluate(`(() => {
      const title = document.getElementById('move-title');
      const group = ${PRESET_GROUP};
      const all = [...document.querySelectorAll('.model-panel button, .model-panel select, .model-panel input')];
      return all.map(el => ({id: el.id, text: el.textContent.trim(), inPresets: !!group && group.contains(el),
        after: !!(title.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)}));
    })()`);
    assert.ok(sequence.every(e => e.after), 'every control sits after #move-title');
    const names = sequence.map(e => (e.inPresets ? e.text : e.id));
    const flat = ORDER.flat(), index = n => names.indexOf(n);
    for (const n of flat) assert.ok(index(n) >= 0, `missing control ${n}; found ${names}`);
    const groups = ORDER.map(g => [].concat(g).map(index));
    for (let i = 1; i < groups.length; i++) assert.ok(Math.min(...groups[i]) > Math.max(...groups[i - 1]), `${[].concat(ORDER[i])} should follow ${[].concat(ORDER[i - 1])} (${names})`);
  }));

browserTest('PE-12 every control is a native focusable element: no tabindex="-1", not inert, visible; the preset group has no tabindex either', () =>
  withExplorer({}, async page => {
    const bad = await page.evaluate(`(() => {
      const ids = ['orbit-left','orbit-right','zoom-in','zoom-out','reset-view','joint-select','elbow-angle','stance-angle','show-skeleton'];
      const els = [...ids.map(i => document.getElementById(i)), ...${PRESET_GROUP}.querySelectorAll('button')];
      return els.filter(el => !el || !['BUTTON','SELECT','INPUT'].includes(el.tagName) || el.getAttribute('tabindex') === '-1' || el.closest('[inert]')
        || el.disabled || el.closest('[hidden]') || (el.tabIndex < 0)).map(el => el ? (el.id || el.textContent) : 'missing');
    })()`);
    assert.deepEqual(bad, []);
  }));

browserTest('PE-12 a preset operates from the keyboard: focus it and press Enter', () =>
  withExplorer({}, async page => {
    assert.equal(await page.evaluate(focusPreset('Back')), true);
    for (const type of ['rawKeyDown', 'char', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', {type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === 'char' ? {text: '\r'} : {})});
    }
    await page.waitFor(`${PRESET_STATE} === 'back'`, {what: 'Enter on the focused Back preset'});
    assert.ok(dist(await page.evaluate('__explorer.camera.position.toArray()'), PRESET_POSITIONS.back) < 1e-3);
  }));

browserTest('PE-12 the joint select operates from the keyboard: ArrowDown moves off "None" and fires change', () =>
  withExplorer({}, async page => {
    await page.evaluate("document.getElementById('joint-select').focus()");
    await page.send('Input.dispatchKeyEvent', {type: 'rawKeyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40});
    await page.send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40});
    await page.waitFor("__explorer.state.selectedJoint !== null", {what: 'a joint selected by keyboard'});
  }));
