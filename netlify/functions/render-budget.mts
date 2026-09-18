import {
  acquireProjectMutation,
  abortProjectMutation,
  commitProjectMutation,
  projectMutationErrorResponse,
  type ProjectMutationLease
} from './_lib/project-concurrency.mts';
import { stageProjectArtifact } from './_lib/project-artifacts.mts';
import {
  normalizeRenderBudgetPolicy,
  readRenderBudgetPolicy,
  summarizeRenderBudget
} from './_lib/render-budget.mts';
import { listProjectAttemptEvents } from './_lib/render-store.mts';
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

async function budgetView(projectId: string, storyVersion?: string | null) {
  const [policy, events] = await Promise.all([
    readRenderBudgetPolicy(projectId),
    listProjectAttemptEvents({
      projectId,
      storyVersion: storyVersion || null,
      limit: 2000
    })
  ]);

  return {
    policy,
    summary: summarizeRenderBudget({
      projectId,
      storyVersion: storyVersion || null,
      events
    })
  };
}

export default async (request: Request) => {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = clean(url.searchParams.get('projectId'), 96);
    const storyVersion = clean(url.searchParams.get('storyVersion'), 96);

    if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);
    if (storyVersion && !safeId(storyVersion)) return json({ error: 'Invalid storyVersion.' }, 400);

    try {
      await authorizeProject(request, projectId, 'project:read');
    } catch (error) {
      const handled = securityErrorResponse(error);
      if (handled) return json(handled.body, handled.status);
      throw error;
    }

    const view = await budgetView(projectId, storyVersion || null);
    return json({
      project_id: projectId,
      story_version: storyVersion || null,
      ...view,
      note: view.policy.max_estimated_cost_per_project_usd === null
        ? 'Attempt ceilings are active. Monetary ceilings remain unset until a human deliberately configures them.'
        : 'Attempt and monetary render guardrails are active.'
    });
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = clean(body.projectId, 96);
  if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);

  try {
    await authorizeProject(request, projectId, 'render:budget');
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  if (body.humanApproved !== true) {
    return json({
      error: 'Changing render-spend policy requires humanApproved: true.',
      code: 'HUMAN_APPROVAL_REQUIRED'
    }, 400);
  }

  let lease: ProjectMutationLease | null = null;
  try {
    lease = await acquireProjectMutation({
      projectId,
      mutationType: 'render-budget-policy',
      expectedRevision: Number.isFinite(Number(body.expectedProjectRevision))
        ? Number(body.expectedProjectRevision)
        : null,
      ttlMs: 30000
    });

    const current = await readRenderBudgetPolicy(projectId);
    const patch = body.policy && typeof body.policy === 'object' ? body.policy : {};
    const policy = normalizeRenderBudgetPolicy(projectId, {
      ...current,
      ...patch
    });

    const ref = await stageProjectArtifact({
      projectId,
      mutationId: lease.mutation_id,
      kind: 'render-budget',
      artifactId: 'policy',
      value: policy
    });

    const committed = await commitProjectMutation(
      lease,
      {
        max_attempts_per_shot: policy.max_attempts_per_shot,
        max_draft_attempts_per_shot: policy.max_draft_attempts_per_shot,
        max_final_attempts_per_shot: policy.max_final_attempts_per_shot,
        max_estimated_cost_per_shot_usd: policy.max_estimated_cost_per_shot_usd,
        max_estimated_cost_per_project_usd: policy.max_estimated_cost_per_project_usd,
        approval_required_over_usd: policy.approval_required_over_usd
      },
      { 'render-budget:policy': ref }
    );

    const storyVersion = clean(body.storyVersion, 96);
    const events = await listProjectAttemptEvents({
      projectId,
      storyVersion: storyVersion && safeId(storyVersion) ? storyVersion : null,
      limit: 2000
    });

    return json({
      policy,
      summary: summarizeRenderBudget({
        projectId,
        storyVersion: storyVersion && safeId(storyVersion) ? storyVersion : null,
        events
      }),
      project_revision: committed.revision,
      mutation_id: committed.mutation_id,
      authoritative_ref: ref
    }, 201);
  } catch (error) {
    if (lease) await abortProjectMutation(lease).catch(() => false);
    const handled = projectMutationErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }
};

export const config = {
  path: '/api/render-budget',
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
