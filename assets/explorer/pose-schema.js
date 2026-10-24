// Pure: pose-estimate and index validation (design §8, ADR-0002). No imports. validatePose and validateIndex never throw;
// they return {ok:true, ...} or {ok:false, errors:[{code, path, message}]}. Messages are plain English, for textContent only.
export const JOINT_NAMES = Object.freeze([
  'pelvis', 'left_hip', 'left_knee', 'left_ankle', 'left_foot', 'right_hip', 'right_knee', 'right_ankle', 'right_foot',
  'spine1', 'spine2', 'spine3', 'left_collar', 'left_shoulder', 'left_elbow', 'left_wrist', 'left_hand',
  'neck', 'head', 'right_collar', 'right_shoulder', 'right_elbow', 'right_wrist', 'right_hand',
]);
export const POSE_JOINTS = Object.freeze(JOINT_NAMES.filter(n => n !== 'pelvis'));
export const MAX_BYTES = 65536;

const JOINT_SET = new Set(POSE_JOINTS), POLLUTING = new Set(['__proto__', 'constructor', 'prototype']);
const HASH = /^[0-9a-f]{64}$/, REVISION = /^[0-9a-f]{40}$/, REPO = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;
const LANDMARKS = ['left_wrist', 'right_wrist', 'left_ankle', 'right_ankle'];
const own = (o, k) => Object.hasOwn(o, k);
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Leaf checkers return [code, message] on failure and null on success. `fix` is a leaf that also rewrites the value.
const text = (code, what, {re, eq, oneOf, max = 200} = {}) => v => {
  if (typeof v !== 'string') return [code, `${what} must be text.`];
  if (v.length > max) return ['E_RANGE', `${what} is longer than ${max} characters.`];
  if (eq !== undefined && v !== eq) return [code, `${what} must be exactly "${eq}".`];
  if (oneOf && !oneOf.includes(v)) return [code, `${what} must be one of: ${oneOf.join(', ')}.`];
  if (re && !re.test(v)) return [code, `${what} is not in the expected format.`];
  if (!eq && !oneOf && !re && !v.length) return [code, `${what} must not be empty.`];
  return null;
};
const finite = v => typeof v === 'number' && Number.isFinite(v);
const vec = (n, limit = Infinity) => v => Array.isArray(v) && v.length === n && v.every(finite) && v.every(x => Math.abs(x) <= limit)
  ? null : ['E_RANGE', `must be ${n} finite numbers${limit < Infinity ? ` within ±${limit}` : ''}.`];
const unit = v => v === undefined ? null : finite(v) && v >= 0 && v <= 1 ? null : finite(v) ? ['E_RANGE', 'must be between 0 and 1.'] : ['E_TYPE', 'must be a number.'];
const bool = v => typeof v === 'boolean' ? null : ['E_TYPE', 'must be true or false.'];
const crop = v => Array.isArray(v) && v.length === 4 && v.every(Number.isInteger) && v[0] >= 0 && v[1] >= 0 && v[2] > 0 && v[3] > 0
  ? null : ['E_RANGE', 'must be four whole numbers [x, y, width, height] with width and height above zero.'];
const date = v => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return ['E_DATE', 'must be a date written YYYY-MM-DD.'];
  const t = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== v ? ['E_DATE', 'is not a real calendar date.'] : null;
};
const quat = v => Array.isArray(v) && v.length === 4 && v.every(finite) && Math.abs(Math.hypot(...v) - 1) <= 1e-3
  ? null : ['E_QUAT', 'must be four finite numbers forming a unit quaternion [x, y, z, w].'];
const normalise = q => { const n = Math.hypot(...q); return q.map(x => x / n); };

const sha = (what, code = 'E_HASH') => text(code, what, {re: HASH});
const rev = what => text('E_REVISION', what, {re: REVISION});
const repo = what => text('E_TYPE', what, {re: REPO});
const label = what => text('E_TYPE', what);

// Schema: an object node is {obj: {key: node}, opt: [optional keys]}; anything else is a leaf function.
const SCHEMA = {obj: {
  schema: text('E_SCHEMA_ID', 'schema', {eq: 'yang-form/pose-estimate'}),
  schemaVersion: null, // handled before the walk
  imageId: text('E_IMAGE_ID', 'imageId', {re: /^(yang|chen)-\d{3}$/}),
  sourceImage: {obj: {
    path: text('E_IMAGE_ID', 'sourceImage.path', {re: /^extracted\/historical\/(yang|chen)-\d{3}\.png$/}),
    sha256: sha('sourceImage.sha256'), crop,
    personPrompt: text('E_TYPE', 'sourceImage.personPrompt', {oneOf: ['box', 'point', 'none']}), mirrored: bool}},
  estimator: {obj: {
    name: text('E_TYPE', 'estimator.name', {eq: 'SAM 3D Body'}), repository: repo('estimator.repository'), revision: rev('estimator.revision'),
    checkpoint: text('E_TYPE', 'estimator.checkpoint', {re: /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/}), checkpointSha256: sha('estimator.checkpointSha256'),
    licence: text('E_TYPE', 'estimator.licence', {eq: 'SAM License'}), outputFrame: label('estimator.outputFrame')}},
  rig: {obj: {name: text('E_TYPE', 'rig.name', {eq: 'MHR'}), repository: repo('rig.repository'), revision: rev('rig.revision'), modelSha256: sha('rig.modelSha256')}},
  converter: {obj: {path: text('E_TYPE', 'converter.path', {re: /^tools\/[\w./-]+\.py$/}), revision: rev('converter.revision')}},
  jointConvention: text('E_CONVENTION', 'jointConvention', {eq: 'yang-form-24/rest-world-delta@1'}),
  jointMap: text('E_TYPE', 'jointMap', {re: /^[a-z0-9-]+@\d+$/}),
  frame: null, root: {obj: {translation: vec(3, 1), rotation: quat}}, joints: null,
  landmarks: null,
  confidence: {obj: {overall: unit, method: label('confidence.method')}},
  review: {obj: {status: null, reviewer: label('review.reviewer'), date,
    leftRight: text('E_TYPE', 'review.leftRight', {oneOf: ['as-photographed', 'side-naming-differs']}), checks: null,
    overlaySha256: sha('review.overlaySha256'), notes: text('E_RANGE', 'review.notes', {max: 1000})}, opt: ['overlaySha256', 'notes']},
}};

function walk(node, value, path, errors, special) {
  const fail = (code, message, p = path) => errors.push({code, path: p, message: `${p || 'file'}: ${message}`});
  if (typeof node === 'function') { const bad = node(value); if (bad) fail(...bad); return; }
  if (!isObject(value)) return fail('E_TYPE', 'must be an object.');
  for (const key of Object.keys(value)) {
    if (POLLUTING.has(key) || !own(node.obj, key)) fail('E_UNKNOWN_KEY', `"${key}" is not an allowed key.`, `${path}${path ? '.' : ''}${key}`);
  }
  for (const [key, child] of Object.entries(node.obj)) {
    const p = `${path}${path ? '.' : ''}${key}`;
    if (!own(value, key)) { if (!node.opt?.includes(key)) fail('E_MISSING', 'is required.', p); continue; }
    if (child === null) special[p]?.(value[key], p, errors);
    else walk(child, value[key], p, errors, special);
  }
}

// Fields whose rules need the origin or a dynamic key set.
function specials(origin) {
  const at = (p, code, message) => ({code, path: p, message: `${p}: ${message}`});
  return {
    schemaVersion: () => {},
    frame: (v, p, e) => {
      const ok = isObject(v) && Object.keys(v).length === 4 && v.up === '+Y' && v.forward === '+Z' && v.left === '+X' && v.units === 'm';
      if (!ok) e.push(at(p, 'E_FRAME', 'must be exactly {up:"+Y", forward:"+Z", left:"+X", units:"m"}.'));
    },
    'review.status': (v, p, e) => {
      if (v !== 'accepted' && !(origin === 'local' && v === 'draft')) e.push(at(p, 'E_STATUS', origin === 'local' ? 'must be "accepted" or "draft".' : 'must be "accepted" for a published estimate.'));
    },
    'review.checks': (v, p, e) => {
      if (!isObject(v)) return e.push(at(p, 'E_TYPE', 'must be an object.'));
      for (const k of ['projection', 'leftRight', 'standingLeg', 'handsFeet', 'truncation', ...Object.keys(v)]) {
        const q = `${p}.${k}`;
        if (!['projection', 'leftRight', 'standingLeg', 'handsFeet', 'truncation'].includes(k)) e.push(at(q, 'E_UNKNOWN_KEY', `"${k}" is not an allowed key.`));
        else if (!own(v, k)) e.push(at(q, 'E_MISSING', 'is required.'));
        else if (typeof v[k] !== 'boolean') e.push(at(q, 'E_TYPE', 'must be true or false.'));
        else if (origin === 'published' && !v[k]) e.push(at(q, 'E_STATUS', 'must be true for a published estimate.'));
      }
    },
    joints: (v, p, e) => {
      if (!isObject(v)) return e.push(at(p, 'E_TYPE', 'must be an object.'));
      const keys = Object.keys(v);
      if (!keys.length) e.push(at(p, 'E_JOINT_NAME', 'must hold at least one joint.'));
      for (const k of keys) {
        const q = `${p}.${k}`;
        if (POLLUTING.has(k)) { e.push(at(q, 'E_UNKNOWN_KEY', `"${k}" is not an allowed key.`)); continue; }
        if (!JOINT_SET.has(k)) { e.push(at(q, 'E_JOINT_NAME', `"${k}" is not a known joint (the pelvis is set through root).`)); continue; }
        walk({obj: {rotation: quat, confidence: unit}, opt: ['confidence']}, v[k], q, e, {});
      }
    },
    landmarks: (v, p, e) => {
      if (!isObject(v)) return e.push(at(p, 'E_TYPE', 'must be an object.'));
      for (const k of Object.keys(v)) if (!LANDMARKS.includes(k)) e.push(at(`${p}.${k}`, 'E_UNKNOWN_KEY', `"${k}" is not an allowed key.`));
      for (const k of LANDMARKS) {
        if (!own(v, k)) e.push(at(`${p}.${k}`, 'E_MISSING', 'is required.'));
        else { const bad = vec(3)(v[k]); if (bad) e.push(at(`${p}.${k}`, bad[0], `${p}.${k} ${bad[1]}`)); }
      }
    },
  };
}

function parse(input) {
  if (typeof input !== 'string') return {value: input};
  if (new TextEncoder().encode(input).length > MAX_BYTES) return {error: {code: 'E_SIZE', path: '', message: 'The file is larger than 64 KiB.'}};
  try { return {value: JSON.parse(input)}; } catch { return {error: {code: 'E_JSON', path: '', message: 'The file is not valid JSON.'}}; }
}

function header(value, schemaId) {
  if (!isObject(value)) return {code: 'E_TYPE', path: '', message: 'The file must hold a JSON object.'};
  if (!own(value, 'schema') || value.schema !== schemaId) return {code: 'E_SCHEMA_ID', path: 'schema', message: `schema must be exactly "${schemaId}".`};
  if (!own(value, 'schemaVersion') || value.schemaVersion !== 1) return {code: 'E_VERSION', path: 'schemaVersion', message: 'schemaVersion must be the number 1; other versions are not read.'};
  return null;
}

/** Validate a pose-estimate file (string or parsed value). `origin` is 'published' (default, strict) or 'local'. */
export function validatePose(input, {origin = 'published'} = {}) {
  try {
    const {value, error} = parse(input);
    if (error) return {ok: false, errors: [error]};
    const bad = header(value, 'yang-form/pose-estimate');
    if (bad) return {ok: false, errors: [bad]};
    const errors = [];
    const special = specials(origin);
    walk(SCHEMA, value, '', errors, {...special, 'review.status': special['review.status'], 'review.checks': special['review.checks']});
    if (typeof value.imageId === 'string' && typeof value.sourceImage?.path === 'string' && !errors.some(e => e.code === 'E_IMAGE_ID')
      && value.sourceImage.path !== `extracted/historical/${value.imageId}.png`) {
      errors.push({code: 'E_IMAGE_ID', path: 'sourceImage.path', message: 'sourceImage.path: must be extracted/historical/<imageId>.png.'});
    }
    if (errors.length) return {ok: false, errors};
    return {ok: true, pose: build(value)};
  } catch {
    return {ok: false, errors: [{code: 'E_TYPE', path: '', message: 'The file could not be read as a pose estimate.'}]};
  }
}

// Fresh object holding only validated fields, so nothing from the input (prototype or otherwise) leaks through.
function build(v) {
  const copy = x => Array.isArray(x) ? x.map(copy) : isObject(x) ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, copy(y)])) : x;
  const pose = copy(v);
  pose.root.rotation = normalise(pose.root.rotation);
  for (const joint of Object.values(pose.joints)) joint.rotation = normalise(joint.rotation);
  return pose;
}

/** Validate the estimate index. Returns {ok:true, index} or {ok:false, errors}. */
export function validateIndex(input) {
  try {
    const {value, error} = parse(input);
    if (error) return {ok: false, errors: [error]};
    const bad = header(value, 'yang-form/pose-estimate-index');
    if (bad) return {ok: false, errors: [bad]};
    const errors = [], at = (path, code, message) => errors.push({code, path, message: `${path}: ${message}`});
    for (const k of Object.keys(value)) if (!['schema', 'schemaVersion', 'estimates'].includes(k)) at(k, 'E_UNKNOWN_KEY', `"${k}" is not an allowed key.`);
    if (!own(value, 'estimates')) at('estimates', 'E_MISSING', 'is required.');
    else if (!Array.isArray(value.estimates)) at('estimates', 'E_TYPE', 'must be a list.');
    else {
      const seen = new Set();
      value.estimates.forEach((entry, i) => {
        const p = `estimates[${i}]`;
        if (!isObject(entry)) return at(p, 'E_TYPE', 'must be an object.');
        for (const k of Object.keys(entry)) if (!['imageId', 'file', 'sha256'].includes(k)) at(`${p}.${k}`, 'E_UNKNOWN_KEY', `"${k}" is not an allowed key.`);
        for (const k of ['imageId', 'file', 'sha256']) if (!own(entry, k)) at(`${p}.${k}`, 'E_MISSING', 'is required.');
        if (own(entry, 'imageId') && (typeof entry.imageId !== 'string' || !/^(yang|chen)-\d{3}$/.test(entry.imageId))) at(`${p}.imageId`, 'E_IMAGE_ID', 'must look like chen-001 or yang-001.');
        else if (own(entry, 'imageId')) {
          if (seen.has(entry.imageId)) at(`${p}.imageId`, 'E_IMAGE_ID', 'is listed twice.');
          seen.add(entry.imageId);
          if (own(entry, 'file') && entry.file !== `${entry.imageId}.json`) at(`${p}.file`, 'E_IMAGE_ID', 'must be <imageId>.json.');
        }
        if (own(entry, 'sha256') && !(typeof entry.sha256 === 'string' && HASH.test(entry.sha256))) at(`${p}.sha256`, 'E_HASH', 'must be 64 lowercase hex characters.');
      });
    }
    if (errors.length) return {ok: false, errors};
    return {ok: true, index: {schema: value.schema, schemaVersion: 1, estimates: value.estimates.map(({imageId, file, sha256}) => ({imageId, file, sha256}))}};
  } catch {
    return {ok: false, errors: [{code: 'E_TYPE', path: '', message: 'The file could not be read as an index.'}]};
  }
}
