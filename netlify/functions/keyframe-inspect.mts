import { inspectKeyframe } from './_lib/visual-inspector-ai.mts';
import {
  readLatestKeyframeInspection,
  readRenderSpec,
  saveKeyframeInspection
} from './_lib/render-store.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 1800) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const safeHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol);
  } catch {
    return false;
  }
};

export default async (request: Request) => {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = clean(url.searchParams.get('projectId'), 96);
    const storyVersion = clean(url.searchParams.get('storyVersion'), 96);
    const sceneId = clean(url.searchParams.get('sceneId'), 96);
    const shotId = clean(url.searchParams.get('shotId'), 96);
    const specHash = clean(url.searchParams.get('specHash'), 96);

    if (![projectId, storyVersion, sceneId, shotId, specHash].every((value) => value && safeId(value))) {
      return json({ error: 'Valid projectId, storyVersion, sceneId, shotId and specHash are required.' }, 400);
    }

    const report = await readLatestKeyframeInspection({
      projectId,
      storyVersion,
      sceneId,
      shotId,
      specHash
    });

    if (!report) return json({ error: 'No Visual Inspector report exists for this shot/spec.' }, 404);
    return json(report);
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = clean(body.projectId, 96);
  const storyVersion = clean(body.storyVersion, 96);
  const sceneId = clean(body.sceneId, 96);
  const shotId = clean(body.shotId, 96);
  const specHash = clean(body.specHash, 96);
  const assetUri = clean(body.assetUri, 1800);

  if (![projectId, storyVersion, sceneId, shotId, specHash].every((value) => value && safeId(value))) {
    return json({ error: 'Valid projectId, storyVersion, sceneId, shotId and specHash are required.' }, 400);
  }
  if (!assetUri || !safeHttpUrl(assetUri)) return json({ error: 'A valid http(s) assetUri is required.' }, 400);

  const spec = await readRenderSpec({
    projectId,
    storyVersion,
    sceneId,
    shotId,
    specHash
  });
  if (!spec) return json({ error: 'The exact ShotRenderSpec was not found.' }, 404);

  const report = await inspectKeyframe({ assetUri, spec });
  const storageRef = await saveKeyframeInspection(report);

  return json({
    ...report,
    storage_ref: storageRef,
    human_approval_still_required: true,
    note: report.decision === 'CLEAR_FOR_HUMAN_REVIEW'
      ? 'Automated inspection found no hard blocker. A human still decides whether this frame becomes canon.'
      : report.decision === 'REPAIR_BEFORE_REVIEW'
        ? 'Automated inspection found defects worth repairing before human approval.'
        : 'Automated inspection was unavailable; use the human first-frame checklist.'
  }, 201);
};

export const config = {
  path: '/api/keyframe-inspect',
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
