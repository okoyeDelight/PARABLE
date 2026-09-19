import { evaluateRenderQA, type RenderQAInput } from './_lib/render-foundation.mts';
import {
  readLatestRenderQA,
  readRenderAttempt,
  saveRenderQA,
  appendRenderAttemptEvent
} from './_lib/render-store.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(value);

export default async (request: Request) => {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const attemptId = clean(url.searchParams.get('attemptId'), 160);
    if (!attemptId || !safeId(attemptId)) return json({ error: 'A valid attemptId is required.' }, 400);

    const [attempt, qa] = await Promise.all([
      readRenderAttempt(attemptId),
      readLatestRenderQA(attemptId)
    ]);

    if (!attempt) return json({ error: 'Render attempt was not found.' }, 404);
    try {
      await authorizeProject(request, attempt.project_id, 'project:read');
    } catch (error) {
      const handled = securityErrorResponse(error);
      if (handled) return json(handled.body, handled.status);
      throw error;
    }
    return json({
      attempt_id: attemptId,
      qa,
      contract: {
        required_evidence: [
          'identity',
          'wardrobe',
          'prop_continuity',
          'spatial_continuity',
          'composition',
          'motion',
          'lighting',
          'technical',
          'cultural_grounding',
          'performance_intent'
        ],
        optional_evidence: ['audio_sync'],
        automatic_acceptance_requires: 'PASS',
        note: 'This endpoint evaluates measured evidence; it does not pretend to inspect pixels by itself.'
      }
    });
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const attemptId = clean(body.attemptId, 160);
  if (!attemptId || !safeId(attemptId)) return json({ error: 'A valid attemptId is required.' }, 400);

  const attempt = await readRenderAttempt(attemptId);
  if (!attempt) return json({ error: 'Render attempt was not found.' }, 404);

  let access;
  try {
    access = await authorizeProject(request, attempt.project_id, 'review:approve');
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  if (!access.actor.internal && body.humanApproved !== true) {
    return json({
      error: 'Human-supplied render QA evidence requires humanApproved: true.',
      code: 'HUMAN_QA_CONFIRMATION_REQUIRED'
    }, 400);
  }

  if (!['succeeded', 'accepted', 'rejected'].includes(attempt.status)) {
    return json({
      error: 'QA can only evaluate a render attempt after media has been produced.',
      current_status: attempt.status
    }, 409);
  }

  const evidence = body.evidence && typeof body.evidence === 'object'
    ? body.evidence as RenderQAInput
    : {} as RenderQAInput;

  const evaluated = evaluateRenderQA(attemptId, evidence);
  const report: any = {
    ...evaluated,
    evidence_source: access.actor.internal ? 'trusted-automated-inspector' : 'human-review',
    reviewer_actor_id: access.actor.internal ? null : access.actor.actor_id
  };

  if (!access.actor.internal && report.decision === 'PASS') {
    report.decision = 'HUMAN_REVIEW';
    report.warnings = [
      ...(Array.isArray(report.warnings) ? report.warnings : []),
      'Human-entered scores cannot create an automatic QA PASS. Explicit acceptance remains a separate reviewer action.'
    ];
    report.repair_plan = [
      ...(Array.isArray(report.repair_plan) ? report.repair_plan : []),
      {
        target: 'shot',
        action: 'human-review',
        reason: 'Explicit reviewer acceptance is required because this QA evidence was entered by a human.'
      }
    ];
  }

  const ref = await saveRenderQA(report, attempt);
  await appendRenderAttemptEvent(attempt, 'qa-evaluated', {
    qa_decision: report.decision,
    qa_score: report.overall_score,
    qa_ref: ref,
    evidence_source: report.evidence_source,
    reviewer_actor_id: report.reviewer_actor_id
  });

  return json({
    ...report,
    storage_ref: ref,
    note: report.decision === 'PASS'
      ? 'The attempt is eligible for explicit acceptance into the film timeline.'
      : report.decision === 'REPAIR'
        ? 'Repair only the failing dimensions where possible; do not regenerate a good shot blindly.'
        : report.decision === 'REJECT'
          ? 'The attempt is too far from canon/continuity for economical repair.'
          : 'Human judgment is required before this attempt can progress.'
  }, 201);
};

export const config = {
  path: '/api/render-qa',
  rateLimit: {
    windowLimit: 240,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
