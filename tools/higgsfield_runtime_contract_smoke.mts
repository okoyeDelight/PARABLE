import assert from 'node:assert/strict';
import { normalizeHiggsfieldResponse } from '../netlify/functions/_lib/higgsfield-runtime.mts';

const queued = normalizeHiggsfieldResponse({
  status: 'queued',
  request_id: 'req_123',
  status_url: 'https://api.higgsfield.ai/requests/req_123/status'
});
assert.equal(queued.state, 'queued');
assert.equal(queued.request_id, 'req_123');

const processing = normalizeHiggsfieldResponse({ status: 'in_progress', request_id: 'req_123' });
assert.equal(processing.state, 'rendering');
assert.match(String(processing.status_url), /req_123\/status$/);

const complete = normalizeHiggsfieldResponse({
  status: 'completed',
  request_id: 'req_123',
  video: { url: 'https://cdn.example.com/final.mp4' }
});
assert.equal(complete.state, 'succeeded');
assert.equal(complete.asset_uri, 'https://cdn.example.com/final.mp4');

const legacyJobSet = normalizeHiggsfieldResponse({
  status: 'completed',
  id: 'req_legacy',
  jobs: [{ results: { raw: { url: 'https://cdn.example.com/legacy.mp4' } } }]
});
assert.equal(legacyJobSet.state, 'succeeded');
assert.equal(legacyJobSet.request_id, 'req_legacy');

const moderated = normalizeHiggsfieldResponse({ status: 'nsfw', request_id: 'req_bad' });
assert.equal(moderated.state, 'moderated');

const completedWithoutAsset = normalizeHiggsfieldResponse({ status: 'completed', request_id: 'req_empty' });
assert.equal(completedWithoutAsset.state, 'unknown');

console.log(JSON.stringify({
  ok: true,
  queued: queued.state,
  processing: processing.state,
  completed: complete.state,
  moderated: moderated.state,
  schema_drift_fallback: legacyJobSet.state
}, null, 2));
