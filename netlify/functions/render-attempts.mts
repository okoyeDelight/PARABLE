import {
  acquireProjectMutation,
  abortProjectMutation,
  commitProjectMutation,
  projectMutationErrorResponse,
  type ProjectMutationLease
} from './_lib/project-concurrency.mts';
import { stageProjectArtifact } from './_lib/project-artifacts.mts';
import type { RenderAttempt, RenderAttemptStatus } from './_lib/render-foundation.mts';
import {
  appendRenderAttemptEvent,
  listShotAttempts,
  readLatestRenderQA,
  readRenderAttempt,
  readRenderSpec,
  saveRenderAttempt
} from './_lib/render-store.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 1400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const money = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000000) / 1000000 : null;
};

function transitionAllowed(current: RenderAttemptStatus, next: RenderAttemptStatus) {
  const map: Record<RenderAttemptStatus, RenderAttemptStatus[]> = {
    planned: ['queued', 'rendering', 'failed', 'rejected'],
    queued: ['rendering', 'succeeded', 'failed', 'rejected'],
    rendering: ['succeeded', 'failed', 'rejected'],
    succeeded: ['accepted', 'rejected', 'superseded'],
    failed: ['superseded'],
    accepted: ['superseded'],
    rejected: ['superseded'],
    superseded: []
  };
  return map[current]?.includes(next) || current === next;
}

export default async (request: Request) => {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const attemptId = clean(url.searchParams.get('attemptId'), 160);

    if (attemptId) {
      if (!safeId(attemptId)) return json({ error: 'Invalid attemptId.' }, 400);
      const attempt = await readRenderAttempt(attemptId);
      if (!attempt) return json({ error: 'Render attempt was not found.' }, 404);
      const qa = await readLatestRenderQA(attemptId);
      return json({ attempt, qa });
    }

    const projectId = clean(url.searchParams.get('projectId'), 96);
    const storyVersion = clean(url.searchParams.get('storyVersion'), 96);
    const sceneId = clean(url.searchParams.get('sceneId'), 96);
    const shotId = clean(url.searchParams.get('shotId'), 96);

    if (![projectId, storyVersion, sceneId, shotId].every((value) => value && safeId(value))) {
      return json({ error: 'Provide attemptId or valid projectId, storyVersion, sceneId and shotId.' }, 400);
    }

    const events = await listShotAttempts({ projectId, storyVersion, sceneId, shotId, limit: 100 });
    return json({ project_id: projectId, story_version: storyVersion, scene_id: sceneId, shot_id: shotId, events });
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const action = clean(body.action || 'create', 40);

  if (action === 'create') {
    const projectId = clean(body.projectId, 96);
    const storyVersion = clean(body.storyVersion, 96);
    const sceneId = clean(body.sceneId, 96);
    const shotId = clean(body.shotId, 96);
    const specHash = clean(body.specHash, 96);
    const provider = clean(body.provider, 80);
    const model = clean(body.model, 180);

    if (![projectId, storyVersion, sceneId, shotId].every((value) => value && safeId(value))) {
      return json({ error: 'Valid projectId, storyVersion, sceneId and shotId are required.' }, 400);
    }
    if (!provider || !model) return json({ error: 'provider and model are required.' }, 400);

    const spec = await readRenderSpec({
      projectId,
      storyVersion,
      sceneId,
      shotId,
      specHash: specHash || null
    });
    if (!spec) return json({ error: 'A compiled ShotRenderSpec is required before creating a render attempt.' }, 409);

    if (spec.human_review.required_before_final_render && body.draft !== true) {
      return json({
        error: 'This render specification requires human review before a final render attempt.',
        code: 'HUMAN_REVIEW_REQUIRED',
        reasons: spec.human_review.reasons,
        hint: 'Use draft=true for visual development, or resolve the review/rights issues first.'
      }, 409);
    }

    const now = new Date().toISOString();
    const attempt: RenderAttempt = {
      attempt_version: 'parable-render-attempt-v1',
      id: 'render_' + crypto.randomUUID().replaceAll('-', ''),
      project_id: projectId,
      story_version: storyVersion,
      scene_id: sceneId,
      shot_id: shotId,
      spec_hash: spec.spec_hash,
      provider,
      model,
      status: 'planned',
      provider_request_id: null,
      asset_uri: null,
      poster_uri: null,
      estimated_cost_usd: money(body.estimatedCostUsd),
      actual_cost_usd: null,
      latency_ms: null,
      failure_class: null,
      failure_detail: null,
      created_at: now,
      updated_at: now
    };

    await saveRenderAttempt(attempt);
    await appendRenderAttemptEvent(attempt, 'created', { draft: body.draft === true });
    return json(attempt, 201);
  }

  const attemptId = clean(body.attemptId, 160);
  if (!attemptId || !safeId(attemptId)) return json({ error: 'A valid attemptId is required.' }, 400);

  const attempt = await readRenderAttempt(attemptId);
  if (!attempt) return json({ error: 'Render attempt was not found.' }, 404);

  let nextStatus: RenderAttemptStatus | null = null;
  if (action === 'queued') nextStatus = 'queued';
  if (action === 'provider_started') nextStatus = 'rendering';
  if (action === 'result') nextStatus = 'succeeded';
  if (action === 'failure') nextStatus = 'failed';
  if (action === 'reject') nextStatus = 'rejected';
  if (action === 'supersede') nextStatus = 'superseded';
  if (action === 'accept') nextStatus = 'accepted';

  if (!nextStatus) return json({ error: 'Unsupported render-attempt action.' }, 400);
  if (!transitionAllowed(attempt.status, nextStatus)) {
    return json({
      error: 'Invalid render-attempt state transition.',
      current_status: attempt.status,
      requested_status: nextStatus
    }, 409);
  }

  if (action === 'accept') {
    const qa = await readLatestRenderQA(attempt.id);
    const humanOverride = body.humanApproved === true;
    if (qa?.decision !== 'PASS' && !humanOverride) {
      return json({
        error: 'Only a QA PASS can be accepted automatically.',
        code: 'QA_PASS_REQUIRED',
        current_qa_decision: qa?.decision || null,
        hint: 'Repair/re-evaluate the shot, or use humanApproved=true for an explicit human override.'
      }, 409);
    }

    let lease: ProjectMutationLease | null = null;
    try {
      lease = await acquireProjectMutation({
        projectId: attempt.project_id,
        mutationType: 'accept-render',
        expectedRevision: Number.isFinite(Number(body.expectedProjectRevision))
          ? Number(body.expectedProjectRevision)
          : null,
        ttlMs: 30000
      });

      const accepted = {
        ...attempt,
        status: 'accepted' as const,
        updated_at: new Date().toISOString()
      };

      const ref = await stageProjectArtifact({
        projectId: attempt.project_id,
        mutationId: lease.mutation_id,
        kind: 'accepted-render',
        artifactId: attempt.scene_id + ':' + attempt.shot_id,
        value: {
          attempt: accepted,
          qa,
          accepted_by_human_override: humanOverride && qa?.decision !== 'PASS'
        }
      });

      const committed = await commitProjectMutation(
        lease,
        {
          scene_id: attempt.scene_id,
          shot_id: attempt.shot_id,
          attempt_id: attempt.id,
          provider: attempt.provider,
          model: attempt.model,
          qa_decision: qa?.decision || null,
          human_override: humanOverride && qa?.decision !== 'PASS'
        },
        { ['render:accepted:' + attempt.scene_id + ':' + attempt.shot_id]: ref }
      );

      await saveRenderAttempt(accepted);
      await appendRenderAttemptEvent(accepted, 'accepted', {
        project_revision: committed.revision,
        authoritative_ref: ref,
        human_override: humanOverride && qa?.decision !== 'PASS'
      });

      return json({
        attempt: accepted,
        qa,
        project_revision: committed.revision,
        mutation_id: committed.mutation_id,
        authoritative_ref: ref
      });
    } catch (error) {
      if (lease) await abortProjectMutation(lease).catch(() => false);
      const handled = projectMutationErrorResponse(error);
      if (handled) return json(handled.body, handled.status);
      throw error;
    }
  }

  const updated: RenderAttempt = {
    ...attempt,
    status: nextStatus,
    provider_request_id: action === 'provider_started'
      ? clean(body.providerRequestId, 300) || attempt.provider_request_id
      : attempt.provider_request_id,
    asset_uri: action === 'result'
      ? clean(body.assetUri, 1800) || attempt.asset_uri
      : attempt.asset_uri,
    poster_uri: action === 'result'
      ? clean(body.posterUri, 1800) || attempt.poster_uri
      : attempt.poster_uri,
    actual_cost_usd: action === 'result' || action === 'failure'
      ? money(body.actualCostUsd) ?? attempt.actual_cost_usd
      : attempt.actual_cost_usd,
    latency_ms: action === 'result' || action === 'failure'
      ? (Number.isFinite(Number(body.latencyMs)) ? Math.max(0, Math.round(Number(body.latencyMs))) : attempt.latency_ms)
      : attempt.latency_ms,
    failure_class: action === 'failure' ? clean(body.failureClass, 120) || 'other' : attempt.failure_class,
    failure_detail: action === 'failure' ? clean(body.failureDetail, 1200) || 'Renderer reported failure.' : attempt.failure_detail,
    updated_at: new Date().toISOString()
  };

  if (action === 'result' && !updated.asset_uri) {
    return json({ error: 'assetUri is required when recording a successful render result.' }, 400);
  }

  await saveRenderAttempt(updated);
  await appendRenderAttemptEvent(updated, action, {
    reviewer_note: clean(body.note, 500) || null
  });

  return json(updated);
};

export const config = {
  path: '/api/render-attempts',
  rateLimit: {
    windowLimit: 240,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
