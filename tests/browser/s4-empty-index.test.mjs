// PE-35 (browser half): the shipped empty index is fetched once, answers 200, and nothing else is requested.
// PE-34 (browser half, safe part): pose files are never requested from a URL taken from the hash or query.
import assert from 'node:assert/strict';
import test from 'node:test';
import {browserTest, cdpSkipReason, withExplorer} from '../helpers/cdp.mjs';

// Like browserTest, but expected to fail until the named slice lands (reported as TODO, not as a failure).
const todoBrowserTest = (name, todo, fn) => (cdpSkipReason ? test(name, {skip: cdpSkipReason}) : test(name, {todo, timeout: 60000}, fn));

const poseRequests = page => page.requests.filter(u => /\/assets\/pose-estimates\//.test(u));

// Page records request URLs but not response statuses; the page's own Performance API has both (responseStatus).
async function responsesOf(page) {
  return page.evaluate(`performance.getEntriesByType('resource').map(e => ({url: e.name, status: e.responseStatus}))`);
}

todoBrowserTest('PE-35 a normal load makes exactly one pose-estimates request, index.json, with status 200 and no 404', 'slice S5: main.js does not load the index until the binding lands', () =>
  withExplorer({}, async page => {
    await page.until(() => poseRequests(page).length > 0, {what: 'the index request', timeout: 8000});
    await page.quiet(500);
    const requests = poseRequests(page);
    assert.equal(requests.length, 1, requests.join('\n'));
    assert.ok(requests[0].endsWith('/assets/pose-estimates/index.json'), requests[0]);
    const responses = (await responsesOf(page)).filter(r => r.url === requests[0]);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].status, 200);
    assert.deepEqual((await responsesOf(page)).filter(r => r.status === 404).map(r => r.url), [], 'no 404 on the whole page');
    assert.deepEqual([...page.consoleErrors, ...page.logErrors], [], 'no console errors, including resource errors');
  }));

browserTest('PE-35 with the empty index no #apply-estimate button is present or visible, on any of several entries', () =>
  withExplorer({}, async page => {
    const visibleButton = `(() => { const b = document.getElementById('apply-estimate'); return !!b && !b.hidden && b.getClientRects().length > 0; })()`;
    for (const id of [2, 13, 60]) {
      await page.evaluate(`location.hash = 'move=${id}'`);
      await page.quiet(150);
      assert.equal(await page.evaluate(visibleButton), false, `#move=${id}`);
    }
  }));

todoBrowserTest('PE-34 a pose-file URL in the hash or query is never fetched', 'slice S5: needs the index request to exist before "only index.json" is meaningful', () =>
  withExplorer({query: '?explorer-test=1&pose=chen-001.json&file=../x.json&pose-file=https://example.com/p.json', hash: '#move=13&pose=chen-001.json'}, async page => {
    await page.until(() => poseRequests(page).length > 0, {what: 'the index request', timeout: 8000});
    await page.quiet(500);
    assert.deepEqual(poseRequests(page).map(u => u.split('/').pop()), ['index.json']);
    assert.ok(page.requests.every(u => !u.includes('example.com')), 'no cross-origin request');
  }));
