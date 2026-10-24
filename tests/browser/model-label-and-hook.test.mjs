// PE-02 (load path and unavailable path) and PE-37 (test hook gating).
import assert from 'node:assert/strict';
import {browserTest, openPlain, withExplorer} from '../helpers/cdp.mjs';
import {label} from '../helpers/page-expr.mjs';

browserTest('PE-02 after load the label is ILLUSTRATIVE AVATAR, avatar controls are shown and nothing errors', () =>
  withExplorer({}, async page => {
    assert.equal(await page.evaluate(label), 'ILLUSTRATIVE AVATAR');
    assert.equal(await page.evaluate("document.getElementById('avatar-controls').hidden"), false);
    assert.equal(await page.evaluate('__explorer.state.rig'), 'avatar');
    assert.deepEqual([page.consoleErrors, page.logErrors, page.exceptions], [[], [], []]);
  }));

browserTest('PE-02 with the GLB request failing: JOINT RIG · AVATAR UNAVAILABLE, rig visible, exactly one "Avatar could not be loaded" console.error', () =>
  withExplorer({block: 'archive-avatar.glb'}, async page => {
    await page.until(() => page.consoleErrors.length > 0, {what: 'the avatar console.error'});
    assert.equal(await page.evaluate(label), 'JOINT RIG · AVATAR UNAVAILABLE');
    assert.equal(await page.evaluate('__explorer.state.rig'), 'fallback-rig');
    assert.equal(await page.evaluate('__explorer.state.fallbackVisible'), true, 'the procedural rig is visible');
    assert.equal(await page.evaluate("document.getElementById('avatar-controls').hidden"), true, 'avatar-only controls stay hidden');
    await page.quiet(500);                       // let any second error arrive before counting
    assert.equal(page.consoleErrors.length, 1, page.consoleErrors.join(' | '));
    assert.match(page.consoleErrors[0], /^Avatar could not be loaded/);
    assert.deepEqual(page.exceptions, []);
  }));

browserTest('PE-37 without ?explorer-test, window.__explorer is undefined', async () => {
  const page = await openPlain('');
  try { assert.equal(await page.evaluate('typeof window.__explorer'), 'undefined'); } finally { await page.close(); }
});

browserTest('PE-37 with ?explorer-test=0, window.__explorer is undefined', async () => {
  const page = await openPlain('?explorer-test=0');
  try { assert.equal(await page.evaluate('typeof window.__explorer'), 'undefined'); } finally { await page.close(); }
});

browserTest('PE-37 with ?explorer-test=1 the hook is a frozen object with a read-only state snapshot', () =>
  withExplorer({}, async page => {
    assert.equal(await page.evaluate('Object.isFrozen(window.__explorer)'), true);
    const result = await page.evaluate(`(() => {
      'use strict';
      try { __explorer.state = {hacked: true}; } catch {}   // throwing and silently ignoring are both allowed (PE-37)
      const snapshot = __explorer.state; snapshot.checks.elbow = 99; snapshot.hacked = true;
      return {hacked: __explorer.state.hacked, elbow: __explorer.state.checks.elbow, hasRenderer: typeof __explorer.state.renderer};
    })()`);
    assert.equal(result.hacked, undefined, 'assigning to state must have no effect');
    assert.equal(result.elbow, 0, 'mutating a snapshot must not change real state');
    assert.equal(result.hasRenderer, 'string');
  }));
