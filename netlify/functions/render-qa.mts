import { evaluateRenderQA, type RenderQAInput } from './_lib/render-foundation.mts';
import {
  readLatestRenderQA,
  readRenderAttempt,
  saveRenderQA,
  appendRenderAttemptEvent
} from './_lib/render-store.mts';

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
  if (!['succeeded', 'accepted', 'rejected'].includes(attempt.status)) {
    return json({
      error: 'QA can only evaluate a render attempt after media has been produced.',
      current_status: attempt.status
    }, 409);
  }

  const evidence = body.evidence && typeof body.evidence === 'object'
    ? body.evidence as RenderQAInput
    : {} as RenderQAInput;

  const report = evaluateRenderQA(attemptId, evidence);
  const ref = await saveRenderQA(report, attempt);
  await appendRenderAttemptEvent(attempt, 'qa-evaluated', {
    qa_decision: report.decision,
    qa_score: report.overall_score,
    qa_ref: ref
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
