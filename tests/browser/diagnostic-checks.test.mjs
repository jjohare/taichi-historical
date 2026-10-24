// PE-03 (browser half), PE-04, PE-05, PE-07: the joint checks, skeleton toggle and reset behave exactly as in viewer.js.
import assert from 'node:assert/strict';
import {browserTest, withExplorer} from '../helpers/cdp.mjs';
import {loadRest, expectedBend, toArray} from '../helpers/glb.mjs';
import {SNAPSHOT, CAMERA, SCENE_VISIBILITY, setSlider, click, text, dot, dist} from '../helpers/page-expr.mjs';

const {rest} = loadRest();            // independent oracle: rest pose parsed from the GLB, maths from vendored three.core.js
const SKELETON_VISIBLE = /palm|finger|thumb|shoe|Head/;
const same = (got, want, what) => assert.ok(dot(got, want) >= 1 - 1e-9, `${what}: got ${got}, want ${want}`);

browserTest('PE-03 elbow slider at 40 reads 40° and bends both elbows by bend(name, −40)', () =>
  withExplorer({}, async page => {
    await page.evaluate(setSlider('elbow-angle', 40));
    assert.equal(await page.evaluate(text('joint-value')), '40°');
    const snap = await page.evaluate(SNAPSHOT);
    for (const name of ['left_elbow', 'right_elbow']) same(snap[name].q, toArray(expectedBend(rest, name, -40)), name);
  }));

browserTest('PE-03 no other bone moves when only the elbow slider moves', () =>
  withExplorer({}, async page => {
    const before = await page.evaluate(SNAPSHOT);
    await page.evaluate(setSlider('elbow-angle', 40));
    const after = await page.evaluate(SNAPSHOT);
    const moved = Object.keys(before).filter(n => dot(before[n].q, after[n].q) < 1 - 1e-12);
    assert.deepEqual(moved.sort(), ['left_elbow', 'right_elbow']);
  }));

browserTest('PE-04 crouch slider at 30: hips −30, knees +60, ankles −30, pelvis lowered, output 30°', () =>
  withExplorer({}, async page => {
    await page.evaluate(setSlider('stance-angle', 30));
    assert.equal(await page.evaluate(text('stance-value')), '30°');
    const snap = await page.evaluate(SNAPSHOT);
    for (const side of ['left', 'right']) {
      same(snap[`${side}_hip`].q, toArray(expectedBend(rest, `${side}_hip`, -30)), `${side}_hip`);
      same(snap[`${side}_knee`].q, toArray(expectedBend(rest, `${side}_knee`, 60)), `${side}_knee`);
      same(snap[`${side}_ankle`].q, toArray(expectedBend(rest, `${side}_ankle`, -30)), `${side}_ankle`);
    }
    const wantY = 0.94 - 0.8 * (1 - Math.cos(30 * Math.PI / 180));
    assert.ok(Math.abs(snap.pelvis.p[1] - wantY) < 1e-4, `pelvis y ${snap.pelvis.p[1]} vs ${wantY}`);
  }));

browserTest('PE-05 skeleton toggle shows the helper and keeps only palm/finger/thumb/shoe/Head meshes; unchecking restores all', () =>
  withExplorer({}, async page => {
    const initial = await page.evaluate(SCENE_VISIBILITY);
    assert.equal(initial.skeleton, false);
    assert.ok(initial.meshes.length > 0 && initial.meshes.every(m => m.visible));
    await page.evaluate(click('show-skeleton'));
    const on = await page.evaluate(SCENE_VISIBILITY);
    assert.equal(on.skeleton, true);
    for (const m of on.meshes) assert.equal(m.visible, SKELETON_VISIBLE.test(m.name), `mesh ${m.name}`);
    assert.ok(on.meshes.some(m => m.visible) && on.meshes.some(m => !m.visible), 'the filter should keep some meshes and hide others');
    await page.evaluate(click('show-skeleton'));
    const off = await page.evaluate(SCENE_VISIBILITY);
    assert.equal(off.skeleton, false);
    assert.ok(off.meshes.every(m => m.visible));
  }));

browserTest('PE-07 reset restores camera, every bone, both sliders and outputs, and the skeleton toggle', () =>
  withExplorer({}, async page => {
    const rest0 = await page.evaluate(SNAPSHOT);
    await page.evaluate(setSlider('elbow-angle', 60));
    await page.evaluate(setSlider('stance-angle', 40));
    await page.evaluate(click('show-skeleton'));
    await page.evaluate(click('orbit-right'));
    await page.evaluate(click('zoom-in'));
    await page.evaluate(click('reset-view'));
    assert.ok(dist(await page.evaluate(CAMERA), [1.9, 1.45, 2.7]) < 1e-4, 'camera back at the default');
    const snap = await page.evaluate(SNAPSHOT);
    for (const name of Object.keys(rest0)) {
      same(snap[name].q, rest0[name].rq, `${name} rotation`);
      assert.ok(dist(snap[name].p, rest0[name].p) < 1e-4, `${name} position`);
    }
    for (const id of ['elbow-angle', 'stance-angle']) assert.equal(await page.evaluate(`document.getElementById('${id}').value`), '0');
    for (const id of ['joint-value', 'stance-value']) assert.equal(await page.evaluate(text(id)), '0°');
    assert.equal(await page.evaluate("document.getElementById('show-skeleton').checked"), false);
    const view = await page.evaluate(SCENE_VISIBILITY);
    assert.equal(view.skeleton, false);
    assert.ok(view.meshes.every(m => m.visible));
  }));
