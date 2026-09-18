import { readRenderSpec } from './_lib/render-store.mts';
import { routeRenderSpec } from './_lib/render-router.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);

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

  const spec = await readRenderSpec({
    projectId,
    storyVersion,
    sceneId,
    shotId,
    specHash: specHash || null
  });

  if (!spec) {
    return json({
      error: 'Compile this shot before routing it to a renderer.',
      code: 'SHOT_RENDER_SPEC_REQUIRED',
      next_action: 'POST /api/shot-compile'
    }, 409);
  }

  const route = routeRenderSpec(spec);
  return json({
    spec_hash: spec.spec_hash,
    shot_id: spec.shot_id,
    route,
    ready_to_dispatch: Boolean(route.selected),
    note: route.selected
      ? 'A configured renderer satisfies the current ShotRenderSpec.'
      : 'No deployed renderer currently satisfies this shot. This is a configuration/capability condition, not permission to weaken the shot.'
  });
};

export const config = {
  path: '/api/render-route',
  rateLimit: {
    windowLimit: 180,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
