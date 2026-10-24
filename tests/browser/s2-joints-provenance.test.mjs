// PE-13 (browser), PE-14, PE-15, PE-16, PE-17 and the S2 extension of the PE-26/PE-29 scripted session.
import assert from 'node:assert/strict';
import {browserTest, withExplorer, SITE_URL} from '../helpers/cdp.mjs';
import {loadRest} from '../helpers/glb.mjs';
import {setSlider, click, dist} from '../helpers/page-expr.mjs';
import {NEUTRAL_TEXT, PRESET_LABELS, clickPreset, selectJoint, readout, provenance, NONE_VALUE, RGB_OF, selectMove, PRESET_STATE} from '../helpers/s2.mjs';

const {jointNames} = loadRest();

browserTest('PE-13 #joint-select has 25 options (None + the 24 GLB joints), 5 optgroups, unique plain-English labels', () =>
  withExplorer({}, async page => {
    const info = await page.evaluate(`(() => {
      const s = document.getElementById('joint-select');
      return {tag: s.tagName, options: [...s.options].map(o => ({value: o.value, label: o.textContent.trim(), group: o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : null})),
        groups: [...s.querySelectorAll('optgroup')].map(g => g.label)};
    })()`);
    assert.equal(info.tag, 'SELECT');
    assert.equal(info.options.length, 25);
    assert.equal(info.groups.length, 5);
    assert.deepEqual(info.groups, ['Torso and head', 'Left arm', 'Right arm', 'Left leg', 'Right leg']);
    const none = info.options.filter(o => o.label === 'None');
    assert.equal(none.length, 1);
    const joints = info.options.filter(o => o.label !== 'None');
    assert.deepEqual(joints.map(o => o.value).sort(), [...jointNames].sort(), 'option values are the GLB skin joint names');
    assert.ok(joints.every(o => o.group), 'every joint option sits in an optgroup');
    assert.equal(new Set(info.options.map(o => o.label)).size, 25, 'labels are unique');
    const labelOf = v => info.options.find(o => o.value === v).label;
    assert.equal(labelOf('left_elbow'), 'Left elbow');
    assert.equal(labelOf('left_knee'), 'Left knee');
    assert.equal(labelOf('pelvis'), 'Pelvis');
  }));

const MARKER = `(() => { const m = __explorer.state.marker; if (!m) throw new Error('state.marker is missing from the hook snapshot'); return m; })()`;

browserTest('PE-14 selecting left_elbow shows a marker at the bone, in the --accent colour, with depthTest false; None hides it', () =>
  withExplorer({}, async page => {
    assert.equal((await page.evaluate(MARKER)).visible, false, 'no marker before a joint is chosen');
    await page.evaluate(selectJoint('left_elbow'));
    const marker = await page.evaluate(MARKER), bone = await page.evaluate("__explorer.rig.worldPositionOf('left_elbow')");
    assert.equal(marker.visible, true);
    assert.ok(dist(marker.position, bone) < 1e-3, `marker ${marker.position} vs bone ${bone}`);
    assert.equal(marker.depthTest, false);
    const [got, want] = await page.evaluate(`(() => { const rgb = ${RGB_OF}; return [rgb(${JSON.stringify(marker.colour)}), rgb(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())]; })()`);
    assert.ok(dist(got, want) <= 1.5, `marker colour ${got} vs --accent ${want}`);
    await page.evaluate(selectJoint(await page.evaluate(NONE_VALUE)));
    assert.equal((await page.evaluate(MARKER)).visible, false);
  }));

browserTest('PE-14 the marker follows the bone when the pose changes', () =>
  withExplorer({}, async page => {
    await page.evaluate(selectJoint('left_wrist'));
    const before = (await page.evaluate(MARKER)).position;
    await page.evaluate(setSlider('elbow-angle', 80));
    const marker = await page.evaluate(MARKER), bone = await page.evaluate("__explorer.rig.worldPositionOf('left_wrist')");
    assert.ok(dist(bone, before) > 0.01, 'the wrist should have moved');
    assert.ok(dist(marker.position, bone) < 1e-3, 'marker follows the wrist');
  }));

browserTest('PE-15 readout: Left elbow at 40, Left knee at crouch 30 (60), Pelvis at rest, empty with None', () =>
  withExplorer({}, async page => {
    assert.equal(await page.evaluate(readout), '', 'empty with nothing selected');
    assert.equal(await page.evaluate("document.getElementById('joint-readout').getAttribute('aria-live')"), 'polite');
    await page.evaluate(selectJoint('left_elbow'));
    await page.evaluate(setSlider('elbow-angle', 40));
    assert.equal(await page.evaluate(readout), 'Left elbow: 40° from rest');
    await page.evaluate(setSlider('elbow-angle', 0));
    await page.evaluate(selectJoint('left_knee'));
    await page.evaluate(setSlider('stance-angle', 30));
    assert.equal(await page.evaluate(readout), 'Left knee: 60° from rest');
    await page.evaluate(selectJoint('pelvis'));
    assert.equal(await page.evaluate(readout), 'Pelvis: 0° from rest');
    await page.evaluate(selectJoint(await page.evaluate(NONE_VALUE)));
    assert.equal(await page.evaluate(readout), '');
  }));

browserTest('PE-16 reset: preset back to three-quarter, neutral pose, joint kept and its readout 0°', () =>
  withExplorer({}, async page => {
    await page.evaluate(selectJoint('left_elbow'));
    await page.evaluate(setSlider('elbow-angle', 40));
    await page.evaluate(clickPreset('Front'));
    assert.equal(await page.evaluate(PRESET_STATE), 'front');
    await page.evaluate(click('reset-view'));
    assert.equal(await page.evaluate(PRESET_STATE), 'three-quarter');
    assert.equal(await page.evaluate('__explorer.state.pose.kind'), 'neutral');
    assert.equal(await page.evaluate(readout), 'Left elbow: 0° from rest');
    assert.equal(await page.evaluate('__explorer.state.selectedJoint'), 'left_elbow');
    assert.equal(await page.evaluate("document.getElementById('joint-select').value"), 'left_elbow');
    assert.equal((await page.evaluate(MARKER)).visible, true, 'the marker stays on the kept joint');
    assert.equal(await page.evaluate(`[...document.querySelectorAll('[aria-pressed="true"]')].map(b => b.textContent.trim()).includes('Three-quarter')`), true);
  }));

const assertNeutral = async (page, when) => {
  const p = await page.evaluate(provenance);
  assert.deepEqual(p, {label: 'ILLUSTRATIVE AVATAR', text: NEUTRAL_TEXT}, when);
};

browserTest('PE-17 the neutral provenance text is shown after load, slider moves, skeleton toggle and catalogue navigation', () =>
  withExplorer({}, async page => {
    await assertNeutral(page, 'after load');
    await page.evaluate(setSlider('elbow-angle', 50)); await assertNeutral(page, 'after the elbow slider');
    await page.evaluate(setSlider('stance-angle', 30)); await assertNeutral(page, 'after the crouch slider');
    await page.evaluate(click('show-skeleton')); await assertNeutral(page, 'skeleton on');
    await page.evaluate(click('show-skeleton')); await assertNeutral(page, 'skeleton off');
    for (const id of [13, 60, 2]) { await selectMove(page, id); await assertNeutral(page, `after #move=${id}`); }
    assert.equal(await page.evaluate("document.getElementById('model-provenance-detail') !== null"), true, '#model-provenance-detail exists');
  }));

browserTest('PE-26/PE-29 scripted S2 session: five entries, each preset, three joints, both sliders, skeleton, reset — zero console errors, same origin', () =>
  withExplorer({}, async page => {
    for (const id of [13, 27, 60, 88, 2]) await selectMove(page, id);
    for (const label of Object.values(PRESET_LABELS)) await page.evaluate(clickPreset(label));
    for (const joint of ['left_elbow', 'right_knee', 'head']) await page.evaluate(selectJoint(joint));
    await page.evaluate(setSlider('elbow-angle', 55));
    await page.evaluate(setSlider('stance-angle', 35));
    await page.evaluate(click('show-skeleton')); await page.evaluate(click('show-skeleton'));
    await page.evaluate(selectJoint(await page.evaluate(NONE_VALUE)));
    await page.evaluate(click('reset-view'));
    await page.quiet(300);
    assert.deepEqual({console: page.consoleErrors, log: page.logErrors, exceptions: page.exceptions}, {console: [], log: [], exceptions: []});
    const origin = new URL(SITE_URL).origin;
    assert.deepEqual(page.requests.filter(u => !/^(?:data|blob):/.test(u) && new URL(u).origin !== origin), []);
    assert.ok(!page.requests.some(u => u.includes('avatar-neutral')), 'the still image is not fetched on a normal load');
  }));
