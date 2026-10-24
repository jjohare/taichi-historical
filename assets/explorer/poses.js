// Fetches the estimate index and the files it lists, and reads local files. Every file goes through validatePose.
// The page never fetches a URL taken from the location hash or query (PE-34): only `<imageId>.json` from an index entry.
import {validatePose, validateIndex, MAX_BYTES} from './pose-schema.js';
export {validatePose, validateIndex};

const DEFAULT_BASE = new URL('../pose-estimates/', import.meta.url);
const failure = (code, message) => ({ok: false, errors: [{code, path: '', message}]});

/** Fetch index.json. Resolves to {ok:true, entries: Map<imageId, {file, sha256}>} or {ok:false, errors}; never rejects. */
export async function loadIndex(baseUrl = DEFAULT_BASE) {
  try {
    const response = await fetch(new URL('index.json', baseUrl));
    if (!response.ok) return failure('E_JSON', 'The estimate index could not be loaded.');
    const result = validateIndex(await response.text());
    if (!result.ok) return result;
    return {ok: true, entries: new Map(result.index.estimates.map(e => [e.imageId, {file: e.file, sha256: e.sha256}]))};
  } catch { return failure('E_JSON', 'The estimate index could not be loaded.'); }
}

/** Fetch one allowlisted estimate by index entry and validate it as published. Checks the SHA-256 against the index. */
export async function fetchEstimate(baseUrl = DEFAULT_BASE, entry) {
  try {
    if (!/^(yang|chen)-\d{3}\.json$/.test(entry?.file ?? '')) return failure('E_IMAGE_ID', 'That estimate is not in the index.');
    const response = await fetch(new URL(`${entry.file}`, baseUrl));
    if (!response.ok) return failure('E_JSON', 'The estimate could not be loaded.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) return failure('E_SIZE', 'The file is larger than 64 KiB.');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== entry.sha256) return failure('E_HASH', 'The estimate does not match the hash in the index.');
    return validatePose(new TextDecoder().decode(bytes), {origin: 'published'});
  } catch { return failure('E_JSON', 'The estimate could not be loaded.'); }
}

/** Read a user-chosen File and validate it as a local estimate. */
export async function readLocalFile(file) {
  try {
    if (file.size > MAX_BYTES) return failure('E_SIZE', 'The file is larger than 64 KiB.');
    return validatePose(await file.text(), {origin: 'local'});
  } catch { return failure('E_JSON', 'The file could not be read.'); }
}
