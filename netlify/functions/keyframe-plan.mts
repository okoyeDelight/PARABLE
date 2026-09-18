import { buildKeyframePlan } from './_lib/render-foundation.mts';
import { readKeyframePlan, readRenderSpec, saveKeyframePlan } from './_lib/render-store.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(value);

export default async (request: Request) => {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  const source = request.method === 'POST'
    ? await request.json().catch(() => ({})) as Record<string, any>
    : Object.fromEntries(new URL(request.url).searchParams.entries());

  const projectId = clean(source.projectId, 96);
  const storyVersion = clean(source.storyVersion, 96);
  const sceneId = clean(source.sceneId, 96);
  const shotId = clean(source.shotId, 96);
  const specHash = clean(source.specHash, 96);

  if (![projectId, storyVersion, sceneId, shotId].every((value) => value && safeId(value))) {
    return json({ error: 'Valid projectId, storyVersion, sceneId and shotId are required.' }, 400);
  }

  try {
    await authorizeProject(request, projectId, request.method === 'GET' ? 'project:read' : 'render:plan');
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  if (request.method === 'GET') {
    const plan = await readKeyframePlan({
      projectId,
      storyVersion,
      sceneId,
      shotId,
      specHash: specHash || null
    });
    if (!plan) return json({ error: 'Keyframe plan was not found.' }, 404);
    return json(plan);
  }

  const spec = await readRenderSpec({
    projectId,
    storyVersion,
    sceneId,
    shotId,
    specHash: specHash || null
  });

  if (!spec) {
    return json({
      error: 'Compile a ShotRenderSpec before planning keyframes.',
      next_action: 'POST /api/shot-compile'
    }, 409);
  }

  const plan = buildKeyframePlan(spec);
  const storageRef = await saveKeyframePlan(plan);

  return json({
    ...plan,
    storage_ref: storageRef,
    note: 'PARABLE approves the visual world before paying for motion. A motion renderer should not be considered final until the first-frame canon gate is satisfied.'
  }, 201);
};

export const config = {
  path: '/api/keyframe-plan',
  rateLimit: {
    windowLimit: 180,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
