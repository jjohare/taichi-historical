// PE-09 (catalogue selection never moves the rig), PE-26 (S1 portion of the scripted session) and PE-28/PE-29 runtime.
import assert from 'node:assert/strict';
import {browserTest, withExplorer, SITE_URL} from '../helpers/cdp.mjs';
import {SNAPSHOT, label, setSlider, click, text} from '../helpers/page-expr.mjs';

async function selectMove(page, id) {
  const before = await page.evaluate(text('move-title'));
  await page.evaluate(`location.hash = 'move=${id}'`);
  if (id !== 2) await page.waitFor(`document.getElementById('move-title').textContent !== ${JSON.stringify(before)}`, {what: `#move=${id} to render`});
  else await page.waitFor("location.hash === '#move=2'");
  return page.evaluate(text('move-title'));
}

browserTest('PE-09 navigating #move=2 → 13 → 60 leaves every bone quaternion and the label unchanged', () =>
  withExplorer({}, async page => {
    await page.evaluate(setSlider('elbow-angle', 40));          // a non-rest pose, so "unchanged" is not trivially "at rest"
    const before = await page.evaluate(SNAPSHOT), labelBefore = await page.evaluate(label);
    const titles = [];
    for (const id of [2, 13, 60]) titles.push(await selectMove(page, id));
    assert.equal(new Set(titles).size, 3, `the catalogue should have changed entry each time: ${titles}`);
    const after = await page.evaluate(SNAPSHOT);
    for (const name of Object.keys(before)) assert.deepEqual(after[name].q, before[name].q, name);
    assert.equal(await page.evaluate(label), labelBefore);
  }));

browserTest('PE-26/PE-29/PE-28 scripted S1 session: zero console errors, same-origin requests only, no still image or pose files fetched', () =>
  withExplorer({}, async page => {
    for (const id of [13, 27, 60, 88, 2]) await selectMove(page, id);
    await page.evaluate(setSlider('elbow-angle', 55));
    await page.evaluate(setSlider('stance-angle', 35));
    await page.evaluate(click('show-skeleton'));
    await page.evaluate(click('show-skeleton'));
    for (const id of ['orbit-left', 'orbit-right', 'zoom-in', 'zoom-out', 'reset-view']) await page.evaluate(click(id));
    await page.quiet(300);
    assert.deepEqual({console: page.consoleErrors, log: page.logErrors, exceptions: page.exceptions}, {console: [], log: [], exceptions: []});

    const origin = new URL(SITE_URL), base = origin.pathname;
    const offOrigin = page.requests.filter(u => !/^(?:data|blob):/.test(u) && new URL(u).origin !== origin.origin);
    assert.deepEqual(offOrigin, [], 'PE-29: requests leaving the page origin');
    const paths = page.requests.filter(u => u.startsWith(origin.origin)).map(u => new URL(u).pathname.slice(base.length));
    assert.ok(paths.some(p => p === 'assets/explorer/main.js'), 'the explorer entry module should be requested');
    assert.ok(!paths.some(p => p.includes('avatar-neutral')), 'PE-28: the still image must not be fetched on a normal load');
    assert.ok(!paths.some(p => p.startsWith('assets/pose-estimates/') && !p.endsWith('index.json')), 'PE-28: no pose file fetched');
    // PE-28: no new requests compared with the pre-explorer page, apart from explorer/*.js. Explicit allowlist, nothing wildcarded but the selected entry's images.
    const allowed = [
      /^(?:index\.html)?$/, /^favicon\.ico$/, /^assets\/(?:site\.css|site\.js|viewer\.js|catalogue\.json)$/,
      /^assets\/explorer\/[\w-]+\.js$/, /^assets\/vendor\/(?:three\.module|three\.core|OrbitControls|GLTFLoader|BufferGeometryUtils|SkeletonUtils)\.js$/,
      /^assets\/vendor\/noto-serif-sc-subset\.ttf$/, /^assets\/model\/archive-avatar\.glb$/, /^assets\/pose-estimates\/index\.json$/,
      /^extracted\/historical\/(?:yang|chen)-\d{3}\.png$/, /^poses\/[\w-]+\/montage-\d{3}\.png$/,
    ];
    const unexpected = paths.filter(p => !allowed.some(re => re.test(p)));
    assert.deepEqual(unexpected, [], 'PE-28: requests outside the pre-explorer request set');
  }));
