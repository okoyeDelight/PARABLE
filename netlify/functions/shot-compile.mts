import { readAuthoritativeProjectState } from './_lib/project-artifacts.mts';
import { readProjectRevision } from './_lib/project-concurrency.mts';
import { compileShotRenderSpec, type VisualCanon } from './_lib/render-foundation.mts';
import { readRenderSpec, saveRenderSpec } from './_lib/render-store.mts';

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

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = clean(url.searchParams.get('projectId'), 96);
    const storyVersion = clean(url.searchParams.get('storyVersion'), 96);
    const sceneId = clean(url.searchParams.get('sceneId'), 96);
    const shotId = clean(url.searchParams.get('shotId'), 96);
    const specHash = clean(url.searchParams.get('specHash'), 96);

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

    if (!spec) return json({ error: 'Shot render specification was not found.' }, 404);
    return json(spec);
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = clean(body.projectId, 96);
  const sceneId = clean(body.sceneId, 96);
  const shotId = clean(body.shotId, 96);
  const requestedStoryVersion = clean(body.storyVersion, 96);
  const allowDraft = body.allowDraft === true;

  if (![projectId, sceneId, shotId].every((value) => value && safeId(value))) {
    return json({ error: 'Valid projectId, sceneId and shotId are required.' }, 400);
  }

  const canonState = await readAuthoritativeProjectState<VisualCanon>(projectId, 'visual-canon:latest');
  if (!canonState?.value) {
    return json({
      error: 'Visual Canon has not been established for this project.',
      code: 'VISUAL_CANON_REQUIRED',
      next_action: 'POST /api/visual-canon with action=bootstrap before compiling renderer instructions.'
    }, 409);
  }

  const storyVersion = requestedStoryVersion || canonState.value.story_version;
  if (!storyVersion || !safeId(storyVersion)) return json({ error: 'A valid storyVersion is required.' }, 400);

  const contextUrl = new URL('/api/render-context', request.url);
  contextUrl.searchParams.set('projectId', projectId);
  contextUrl.searchParams.set('storyVersion', storyVersion);
  contextUrl.searchParams.set('sceneId', sceneId);
  contextUrl.searchParams.set('shotId', shotId);

  const contextResponse = await fetch(contextUrl, {
    headers: {
      'accept': 'application/json',
      'x-parable-internal': 'shot-compiler'
    }
  });

  const context = await contextResponse.json().catch(() => ({})) as Record<string, any>;
  if (!contextResponse.ok) {
    return json({
      error: context?.error || 'Render Context could not be prepared.',
      code: 'RENDER_CONTEXT_UNAVAILABLE',
      detail: context
    }, contextResponse.status);
  }

  const renderPackage = Array.isArray(context?.packages) ? context.packages[0] : null;
  if (!renderPackage) return json({ error: 'No render package exists for this shot.' }, 409);

  const blockers = Array.isArray(renderPackage?.blockers) ? renderPackage.blockers : [];
  if (!allowDraft && (!renderPackage.can_render || blockers.length)) {
    return json({
      error: 'This shot has not passed the continuity gate.',
      code: 'CONTINUITY_GATE_BLOCKED',
      blockers,
      unchecked_shots: context?.unchecked_shots || [],
      hint: 'Process scene/shot continuity first, or compile with allowDraft=true only for non-final visual development.'
    }, 409);
  }

  const revision = await readProjectRevision(projectId);
  const spec = await compileShotRenderSpec({
    renderPackage,
    canon: canonState.value,
    projectRevision: revision.revision,
    aspectRatio: clean(body.aspectRatio, 20) || undefined,
    durationSeconds: Number(body.durationSeconds) || undefined,
    resolution: clean(body.resolution, 30) || undefined,
    fps: Number(body.fps) || undefined
  });

  if (allowDraft && !renderPackage.can_render) {
    spec.human_review.required_before_final_render = true;
    spec.human_review.reasons.push('This specification was compiled in draft mode before the shot passed the continuity gate.');
  }

  const storageRef = await saveRenderSpec(spec);

  return json({
    ...spec,
    storage_ref: storageRef,
    compile_mode: allowDraft ? 'draft' : 'continuity-gated',
    visual_canon_ref: canonState.ref
  }, 201);
};

export const config = {
  path: '/api/shot-compile',
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
