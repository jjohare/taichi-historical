// Minimal Chrome DevTools Protocol driver for the browsercontainer sidecar (Node 22 global WebSocket, no dependencies).
// Env: CDP_HOST (default localhost), CDP_PORT (9223), SITE_URL (default http://localhost:8790/).
// Internal hostnames stay out of the repository: set them in the environment, e.g.
//   CDP_HOST=browsercontainer SITE_URL=http://agentbox:8790/ npm run test:browser
// When the endpoint is unreachable the browser suites skip with a reason instead of failing.
import dns from 'node:dns/promises';
import http from 'node:http';
import test from 'node:test';

export const CDP_HOST = process.env.CDP_HOST ?? 'localhost';
export const CDP_PORT = Number(process.env.CDP_PORT ?? 9223);
export const SITE_URL = (process.env.SITE_URL ?? 'http://localhost:8790/').replace(/\/?$/, '/');

let ip = null;
// Chrome rejects a Host header that is not an IP or localhost, so resolve the name ourselves.
const request = (method, path) => new Promise((resolve, reject) => {
  const req = http.request({host: ip, port: CDP_PORT, method, path, headers: {Host: 'localhost'}, timeout: 4000}, res => {
    let body = ''; res.setEncoding('utf8'); res.on('data', d => (body += d)); res.on('end', () => resolve({status: res.statusCode, body}));
  });
  req.on('timeout', () => req.destroy(new Error('CDP request timed out')));
  req.on('error', reject); req.end();
});

export const cdpSkipReason = await (async () => {
  try {
    ip = (await dns.lookup(CDP_HOST, {family: 4})).address;
    const res = await request('GET', '/json/version');
    return res.status === 200 ? null : `CDP endpoint ${CDP_HOST}:${CDP_PORT} answered HTTP ${res.status}`;
  } catch (error) {
    return `CDP endpoint ${CDP_HOST}:${CDP_PORT} is unreachable (${error.code ?? error.message}); set CDP_HOST/SITE_URL to run the browser suite`;
  }
})();

/** `test()` that is reported as skipped, with the reason, when no browser is reachable. */
// A hung browser must fail the test, not the whole run: every browser test has a 60 s ceiling.
export const browserTest = (name, fn) => (cdpSkipReason ? test(name, {skip: cdpSkipReason}) : test(name, {timeout: 60000}, fn));

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Page {
  constructor(targetId, ws) {
    this.targetId = targetId; this.ws = ws; this.nextId = 0; this.pending = new Map(); this.waiters = [];
    this.consoleErrors = []; this.consoleWarnings = []; this.logErrors = []; this.exceptions = []; this.requests = []; this.dialogs = [];
    ws.onmessage = e => this.#onMessage(JSON.parse(e.data));
    ws.onclose = () => this.#failAll(new Error('CDP websocket closed'));
  }
  #failAll(error) {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
    for (const w of this.waiters) w.reject(error);
    this.waiters = [];
  }
  #onMessage(m) {
    if (m.id !== undefined) {
      const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id);
      return m.error ? p.reject(new Error(`${p.method}: ${m.error.message}`)) : p.resolve(m.result);
    }
    const text = args => (args ?? []).map(a => a.value ?? a.description ?? '').join(' ');
    switch (m.method) {
      case 'Runtime.consoleAPICalled':
        if (m.params.type === 'error') this.consoleErrors.push(text(m.params.args));
        if (m.params.type === 'warning') this.consoleWarnings.push(text(m.params.args));
        break;
      case 'Log.entryAdded': if (m.params.entry.level === 'error') this.logErrors.push(`${m.params.entry.source}: ${m.params.entry.text} ${m.params.entry.url ?? ''}`); break;
      case 'Runtime.exceptionThrown': this.exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); break;
      case 'Network.requestWillBeSent': this.requests.push(m.params.request.url); break;
      case 'Page.javascriptDialogOpening': this.dialogs.push(m.params.message); this.send('Page.handleJavaScriptDialog', {accept: false}).catch(() => {}); break;
      case 'Fetch.requestPaused': {
        const block = this.blockPattern && m.params.request.url.includes(this.blockPattern);
        this.send(block ? 'Fetch.failRequest' : 'Fetch.continueRequest', block ? {requestId: m.params.requestId, errorReason: 'Failed'} : {requestId: m.params.requestId}).catch(() => {});
        break;
      }
    }
    this.waiters = this.waiters.filter(w => (w.method === m.method ? (w.resolve(m.params), false) : true));
  }
  send(method, params = {}, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: no CDP response within ${timeout} ms`)); }, timeout);
      this.pending.set(id, {method, resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); }});
      try { this.ws.send(JSON.stringify({id, method, params})); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  once(method, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters = this.waiters.filter(w => w !== waiter); reject(new Error(`${method}: not fired within ${timeout} ms`)); }, timeout);
      const waiter = {method, resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); }};
      this.waiters.push(waiter);
    });
  }
  /** Evaluate an expression (awaiting promises) and return its JSON value. Throws on a page exception. */
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (r.exceptionDetails) throw new Error(`page exception: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  }
  /** Poll a page-side predicate. Polling is bounded by `timeout`; there are no fixed sleeps before assertions. */
  async waitFor(expression, {timeout = 10000, interval = 50, what = expression} = {}) {
    const end = Date.now() + timeout;
    let lastError = null;
    for (;;) {
      let value; try { value = await this.evaluate(expression); lastError = null; } catch (error) { value = false; lastError = error; }
      if (value) return value;
      if (Date.now() > end) throw new Error(`timed out after ${timeout} ms waiting for: ${what}${lastError ? ` (last page error: ${lastError.message})` : ''}`);
      await sleep(interval);
    }
  }
  /** Poll a node-side predicate (e.g. over collected console messages). */
  async until(predicate, {timeout = 5000, interval = 50, what = 'condition'} = {}) {
    const end = Date.now() + timeout;
    while (!predicate()) { if (Date.now() > end) throw new Error(`timed out after ${timeout} ms waiting for ${what}`); await sleep(interval); }
  }
  /** Wait in page time for `ms` (used only to assert that something does NOT happen). */
  quiet(ms) { return sleep(ms); }
  async navigate(url) {
    const loaded = this.once('Page.loadEventFired');
    try { await this.send('Page.navigate', {url}); } catch (error) { loaded.catch(() => {}); throw error; }
    await loaded;
  }
  async close() {
    try { this.ws.close(); } catch {}
    try { await request('GET', `/json/close/${this.targetId}`); } catch {}
  }
}

/** Open a fresh tab, enable the event domains, optionally block requests whose URL contains `block`. */
export async function openPage({block} = {}) {
  const created = await request('PUT', '/json/new?about:blank');
  if (created.status !== 200) throw new Error(`CDP /json/new answered HTTP ${created.status}: ${created.body.slice(0, 200)}`);
  const target = JSON.parse(created.body);
  const ws = new WebSocket(`ws://${ip}:${CDP_PORT}/devtools/page/${target.id}`);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('CDP websocket failed')); });
  const page = new Page(target.id, ws);
  try {
    for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await page.send(`${domain}.enable`);
    // The sidecar Chrome once served a stale viewer.js from cache; never cache in tests.
    await page.send('Network.setCacheDisabled', {cacheDisabled: true});
    // A tab that is not frontmost can have its requestAnimationFrame paused, which would starve render-on-demand.
    await page.send('Page.bringToFront');
    await page.send('Emulation.setFocusEmulationEnabled', {enabled: true});
    if (block) { page.blockPattern = block; await page.send('Fetch.enable', {patterns: [{urlPattern: `*${block}*`}]}); }
  } catch (error) { await page.close(); throw error; }
  return page;
}

let hookMissing = null;
/**
 * Open the site with `?explorer-test=1` and wait for the rig to settle. Memoises "hook absent" so a suite whose
 * implementation has not landed fails in seconds, once, rather than waiting per test.
 */
export async function openExplorer({query = '?explorer-test=1', hash = '', block, timeout = 12000} = {}) {
  if (hookMissing) throw new Error(hookMissing);
  const page = await openPage({block});
  try {
    await page.navigate(`${SITE_URL}${query}${hash}`);
    if (!(await page.evaluate("!!document.getElementById('model-label')"))) {
      throw new Error(`the site at ${SITE_URL} did not load (no #model-label); is the static server running?`);
    }
    try {
      await page.waitFor("window.__explorer && window.__explorer.state.rig !== 'pending'", {timeout, what: 'window.__explorer with a settled rig'});
    } catch (error) {
      const hook = await page.evaluate('typeof window.__explorer');
      if (hook === 'undefined') hookMissing = `window.__explorer is undefined at ${SITE_URL}${query}: the test hook is not installed (${error.message})`;
      throw new Error(hookMissing ?? error.message);
    }
    // The panel sits below the fold; the IntersectionObserver stops rendering while it is off-screen (by design, PE-08).
    // site.css sets scroll-behavior:smooth, which would animate for ~2 s and cause a late render inside an idle window: scroll instantly.
    await page.evaluate("document.getElementById('model-view').scrollIntoView({behavior: 'instant', block: 'start'})");
    await page.waitFor('__explorer.state.visible === true', {what: 'the panel to report visible'});
    await page.waitFor('__explorer.state.renderCount > 0', {what: 'the first render'});
    return page;
  } catch (error) { await page.close(); throw error; }
}

/** Open the site without requiring the hook (used for the gating checks) and wait for the avatar label to settle. */
export async function openPlain(query = '') {
  const page = await openPage();
  try {
    await page.navigate(`${SITE_URL}${query}`);
    await page.waitFor("document.getElementById('model-label')?.textContent === 'ILLUSTRATIVE AVATAR'", {what: 'avatar label'});
    return page;
  } catch (error) { await page.close(); throw error; }
}

/** Run `fn(page)` against a fresh explorer page and always close it. */
export async function withExplorer(options, fn) {
  const page = await openExplorer(options);
  try { return await fn(page); } finally { await page.close(); }
}
