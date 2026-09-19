import {
  analyzeCinematicReference,
  saveInspirationProfile,
  type InspirationProfile
} from './_lib/inspiration-profile-ai.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 1800) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,180}$/.test(value);
const safeHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol);
  } catch {
    return false;
  }
};

export default async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const jobId = clean(request.headers.get('x-parable-job-id'), 180);
  const workload = clean(request.headers.get('x-parable-workload'), 80);
  if (!jobId || !safeId(jobId) || workload !== 'durable-pipeline') {
    return json({
      error: 'Cinematic-reference analysis must run through PARABLE durable jobs.',
      code: 'DURABLE_JOB_REQUIRED',
      next_action: 'POST /api/jobs with kind=reference-profile and an Idempotency-Key.'
    }, 409);
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = clean(body.projectId, 96);
  const storyVersion = clean(body.storyVersion, 96);
  const imageUri = clean(body.imageUri, 1800);
  const origin = clean(body.origin || 'official-media', 40) as InspirationProfile['source']['origin'];
  const rightsStatus = clean(body.rightsStatus || 'unverified', 40) as InspirationProfile['source']['rights_status'];

  if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);

  try {
    const access = await authorizeProject(request, projectId, 'project:edit');
    if (!access.actor.internal) {
      return json({
        error: 'Cinematic reference profiling must execute through a trusted durable worker.',
        code: 'INTERNAL_REFERENCE_WORKER_REQUIRED'
      }, 403);
    }
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  if (storyVersion && !safeId(storyVersion)) return json({ error: 'Invalid storyVersion.' }, 400);
  if (!imageUri || !safeHttpUrl(imageUri)) return json({ error: 'A valid public http(s) imageUri is required.' }, 400);
  if (!['official-media','licensed','owned','public-domain','unknown'].includes(origin)) {
    return json({ error: 'Invalid reference origin.' }, 400);
  }
  if (!['approved','unverified','restricted','revoked'].includes(rightsStatus)) {
    return json({ error: 'Invalid rightsStatus.' }, 400);
  }
  if (rightsStatus === 'revoked') {
    return json({
      error: 'A revoked reference cannot enter the inspiration library.',
      code: 'REFERENCE_RIGHTS_REVOKED'
    }, 409);
  }

  const profile = await analyzeCinematicReference({
    projectId,
    storyVersion: storyVersion || null,
    imageUri,
    title: clean(body.sourceTitle, 260) || null,
    creator: clean(body.sourceCreator, 260) || null,
    sourceUrl: clean(body.sourceUrl, 1800) || null,
    origin,
    rightsStatus
  });

  await saveInspirationProfile(profile);

  return json({
    ...profile,
    identity_rendering_allowed: false,
    note: 'This profile is inspiration-only. It can shape original casting/cinematography language but is never sent as an actor-identity reference unless rights are separately approved.'
  }, 201);
};

export const config = {
  path: '/api/reference-profile',
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
