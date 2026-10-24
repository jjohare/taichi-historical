// PE-06 (orbit and zoom buttons) and PE-08 (render on demand, runtime half).
import assert from 'node:assert/strict';
import {browserTest, withExplorer} from '../helpers/cdp.mjs';
import {CAMERA, click, dist} from '../helpers/page-expr.mjs';

const TARGET = [0, 0.95, 0];
const rotateY = (p, a) => { const [x, y, z] = [p[0] - TARGET[0], p[1] - TARGET[1], p[2] - TARGET[2]]; return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)].map((v, i) => v + TARGET[i]); };
const distance = p => dist(p, TARGET);

browserTest('PE-06 orbit buttons rotate the camera offset by ∓π/8 about +Y around (0, 0.95, 0)', () =>
  withExplorer({}, async page => {
    for (const [id, angle] of [['orbit-left', -Math.PI / 8], ['orbit-right', Math.PI / 8]]) {
      await page.evaluate(click('reset-view'));
      const before = await page.evaluate(CAMERA);
      await page.evaluate(click(id));
      const after = await page.evaluate(CAMERA);
      assert.ok(dist(after, rotateY(before, angle)) < 1e-4, `${id}: ${after} vs ${rotateY(before, angle)}`);
    }
  }));

browserTest('PE-06 zoom-in scales the distance by 0.85, zoom-out by 1.15, clamped to [2.2, 7]', () =>
  withExplorer({}, async page => {
    const d0 = distance(await page.evaluate(CAMERA));
    await page.evaluate(click('zoom-in'));
    assert.ok(Math.abs(distance(await page.evaluate(CAMERA)) - d0 * 0.85) < 1e-4);
    await page.evaluate(click('reset-view'));
    await page.evaluate(click('zoom-out'));
    assert.ok(Math.abs(distance(await page.evaluate(CAMERA)) - d0 * 1.15) < 1e-4);
    for (let i = 0; i < 30; i++) await page.evaluate(click('zoom-in'));
    assert.ok(Math.abs(distance(await page.evaluate(CAMERA)) - 2.2) < 1e-4, 'clamped at 2.2');
    for (let i = 0; i < 40; i++) await page.evaluate(click('zoom-out'));
    assert.ok(Math.abs(distance(await page.evaluate(CAMERA)) - 7) < 1e-4, 'clamped at 7');
  }));

const renderCount = page => page.evaluate('__explorer.state.renderCount');
/** Wait until load-time renders (resize, observers, scroll) have drained: the count is unchanged for 1 s. */
async function settle(page) {
  for (let last = -1, i = 0; i < 20; i++) {
    const now = await renderCount(page);
    if (now === last) return;
    last = now; await page.quiet(1000);
  }
  throw new Error('renderCount never settled: something is rendering continuously');
}

browserTest('PE-08 renderCount does not change over 3 s without interaction, and rises after a camera action', () =>
  withExplorer({}, async page => {
    await settle(page);
    const before = await renderCount(page);
    await page.quiet(3000);
    assert.equal(await renderCount(page), before, 'a render loop is running');
    await page.evaluate(click('orbit-right'));
    await page.waitFor(`__explorer.state.renderCount > ${before}`, {what: 'renderCount to rise after orbit'});
  }));

browserTest('PE-08 a programmatic orbit while the panel is scrolled out of view does not render until it is visible again', () =>
  withExplorer({}, async page => {
    await settle(page);
    await page.evaluate("document.body.append(Object.assign(document.createElement('div'), {id: 'test-spacer', style: 'height:20000px'})); window.scrollTo(0, document.body.scrollHeight);");
    await page.waitFor("(() => { const r = document.getElementById('model-view').getBoundingClientRect(); return r.bottom < 0 || r.top > innerHeight; })()", {what: 'model panel out of view'});
    await page.quiet(500);                       // IntersectionObserver delivers asynchronously; there is no event to await
    const before = await renderCount(page);
    await page.evaluate(click('orbit-right'));
    await page.quiet(500);
    assert.equal(await renderCount(page), before, 'rendered while hidden');
    await page.evaluate("document.getElementById('model-view').scrollIntoView()");
    await page.waitFor(`__explorer.state.renderCount > ${before}`, {what: 'a render once visible again'});
  }));
