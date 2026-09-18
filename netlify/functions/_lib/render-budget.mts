import { readAuthoritativeProjectState } from './project-artifacts.mts';
import { listProjectAttemptEvents } from './render-store.mts';

export type RenderBudgetPolicy = {
  budget_version: 'parable-render-budget-v1';
  project_id: string;
  max_attempts_per_shot: number;
  max_draft_attempts_per_shot: number;
  max_final_attempts_per_shot: number;
  max_estimated_cost_per_shot_usd: number | null;
  max_estimated_cost_per_project_usd: number | null;
  approval_required_over_usd: number | null;
  currency: 'USD';
  updated_at: string;
};

export type RenderBudgetSummary = {
  project_id: string;
  story_version: string | null;
  attempts_observed: number;
  draft_attempts: number;
  final_attempts: number;
  estimated_cost_usd: number;
  actual_cost_usd: number;
  committed_or_estimated_cost_usd: number;
  shots: Record<string, {
    attempts: number;
    draft_attempts: number;
    final_attempts: number;
    estimated_cost_usd: number;
    actual_cost_usd: number;
    committed_or_estimated_cost_usd: number;
  }>;
};

export type RenderBudgetDecision = {
  allowed: boolean;
  code:
    | 'OK'
    | 'RENDER_ATTEMPT_LIMIT_REACHED'
    | 'RENDER_COST_ESTIMATE_REQUIRED'
    | 'RENDER_SHOT_BUDGET_EXCEEDED'
    | 'RENDER_PROJECT_BUDGET_EXCEEDED'
    | 'RENDER_COST_APPROVAL_REQUIRED';
  message: string;
  requires_human_approval: boolean;
  policy: RenderBudgetPolicy;
  summary: RenderBudgetSummary;
  projected: {
    shot_attempts: number;
    shot_mode_attempts: number;
    shot_cost_usd: number;
    project_cost_usd: number;
  };
};

const roundMoney = (value: number) => Math.round(value * 1000000) / 1000000;
const finiteMoney = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? roundMoney(n) : null;
};

export function defaultRenderBudgetPolicy(projectId: string): RenderBudgetPolicy {
  return {
    budget_version: 'parable-render-budget-v1',
    project_id: projectId,
    max_attempts_per_shot: 8,
    max_draft_attempts_per_shot: 6,
    max_final_attempts_per_shot: 4,
    max_estimated_cost_per_shot_usd: null,
    max_estimated_cost_per_project_usd: null,
    approval_required_over_usd: null,
    currency: 'USD',
    updated_at: new Date().toISOString()
  };
}

function normalizePositiveInt(value: unknown, fallback: number, min = 1, max = 100) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function normalizeRenderBudgetPolicy(
  projectId: string,
  input: Partial<RenderBudgetPolicy> | Record<string, unknown>
): RenderBudgetPolicy {
  const fallback = defaultRenderBudgetPolicy(projectId);
  return {
    budget_version: 'parable-render-budget-v1',
    project_id: projectId,
    max_attempts_per_shot: normalizePositiveInt(input.max_attempts_per_shot, fallback.max_attempts_per_shot, 1, 40),
    max_draft_attempts_per_shot: normalizePositiveInt(input.max_draft_attempts_per_shot, fallback.max_draft_attempts_per_shot, 1, 30),
    max_final_attempts_per_shot: normalizePositiveInt(input.max_final_attempts_per_shot, fallback.max_final_attempts_per_shot, 1, 20),
    max_estimated_cost_per_shot_usd: input.max_estimated_cost_per_shot_usd === null
      ? null
      : finiteMoney(input.max_estimated_cost_per_shot_usd),
    max_estimated_cost_per_project_usd: input.max_estimated_cost_per_project_usd === null
      ? null
      : finiteMoney(input.max_estimated_cost_per_project_usd),
    approval_required_over_usd: input.approval_required_over_usd === null
      ? null
      : finiteMoney(input.approval_required_over_usd),
    currency: 'USD',
    updated_at: new Date().toISOString()
  };
}

type AttemptSnapshot = {
  attempt_id: string;
  scene_id: string;
  shot_id: string;
  mode: 'draft' | 'final';
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  at: string;
};

function latestAttemptSnapshots(events: Record<string, any>[]) {
  const byAttempt = new Map<string, AttemptSnapshot>();

  for (const event of events) {
    const attemptId = String(event?.attempt_id || '').trim();
    if (!attemptId) continue;

    const at = String(event?.at || '');
    const shotId = String(event?.shot_id || event?.metadata?.shot_id || '').trim();
    const sceneId = String(event?.scene_id || event?.metadata?.scene_id || '').trim();
    const prior = byAttempt.get(attemptId);
    if (prior && prior.at > at) continue;

    byAttempt.set(attemptId, {
      attempt_id: attemptId,
      scene_id: sceneId,
      shot_id: shotId,
      mode: event?.mode === 'final' ? 'final' : 'draft',
      estimated_cost_usd: finiteMoney(event?.estimated_cost_usd),
      actual_cost_usd: finiteMoney(event?.actual_cost_usd),
      at
    });
  }

  return [...byAttempt.values()];
}

export function summarizeRenderBudget(args: {
  projectId: string;
  storyVersion?: string | null;
  events: Record<string, any>[];
}) {
  const snapshots = latestAttemptSnapshots(args.events);
  const shots: RenderBudgetSummary['shots'] = {};

  let estimated = 0;
  let actual = 0;
  let committed = 0;
  let draftAttempts = 0;
  let finalAttempts = 0;

  for (const attempt of snapshots) {
    const shotKey = attempt.shot_id || 'unknown-shot';
    if (!shots[shotKey]) {
      shots[shotKey] = {
        attempts: 0,
        draft_attempts: 0,
        final_attempts: 0,
        estimated_cost_usd: 0,
        actual_cost_usd: 0,
        committed_or_estimated_cost_usd: 0
      };
    }

    const shot = shots[shotKey];
    shot.attempts += 1;
    if (attempt.mode === 'final') {
      shot.final_attempts += 1;
      finalAttempts += 1;
    } else {
      shot.draft_attempts += 1;
      draftAttempts += 1;
    }

    const estimate = attempt.estimated_cost_usd || 0;
    const actualCost = attempt.actual_cost_usd || 0;
    const effective = attempt.actual_cost_usd ?? attempt.estimated_cost_usd ?? 0;

    shot.estimated_cost_usd = roundMoney(shot.estimated_cost_usd + estimate);
    shot.actual_cost_usd = roundMoney(shot.actual_cost_usd + actualCost);
    shot.committed_or_estimated_cost_usd = roundMoney(shot.committed_or_estimated_cost_usd + effective);

    estimated += estimate;
    actual += actualCost;
    committed += effective;
  }

  return {
    project_id: args.projectId,
    story_version: args.storyVersion || null,
    attempts_observed: snapshots.length,
    draft_attempts: draftAttempts,
    final_attempts: finalAttempts,
    estimated_cost_usd: roundMoney(estimated),
    actual_cost_usd: roundMoney(actual),
    committed_or_estimated_cost_usd: roundMoney(committed),
    shots
  } satisfies RenderBudgetSummary;
}

export function evaluateRenderBudget(args: {
  policy: RenderBudgetPolicy;
  summary: RenderBudgetSummary;
  shotId: string;
  mode: 'draft' | 'final';
  estimatedCostUsd: number | null;
  humanApproved?: boolean;
}): RenderBudgetDecision {
  const { policy, summary } = args;
  const shot = summary.shots[args.shotId] || {
    attempts: 0,
    draft_attempts: 0,
    final_attempts: 0,
    estimated_cost_usd: 0,
    actual_cost_usd: 0,
    committed_or_estimated_cost_usd: 0
  };

  const proposedCost = args.estimatedCostUsd ?? 0;
  const projected = {
    shot_attempts: shot.attempts + 1,
    shot_mode_attempts: (args.mode === 'draft' ? shot.draft_attempts : shot.final_attempts) + 1,
    shot_cost_usd: roundMoney(shot.committed_or_estimated_cost_usd + proposedCost),
    project_cost_usd: roundMoney(summary.committed_or_estimated_cost_usd + proposedCost)
  };

  const decision = (
    allowed: boolean,
    code: RenderBudgetDecision['code'],
    message: string,
    requiresHumanApproval = false
  ): RenderBudgetDecision => ({
    allowed,
    code,
    message,
    requires_human_approval: requiresHumanApproval,
    policy,
    summary,
    projected
  });

  if (projected.shot_attempts > policy.max_attempts_per_shot) {
    return decision(
      false,
      'RENDER_ATTEMPT_LIMIT_REACHED',
      'This shot reached the total render-attempt ceiling. Review existing attempts before spending more.'
    );
  }

  const modeLimit = args.mode === 'draft'
    ? policy.max_draft_attempts_per_shot
    : policy.max_final_attempts_per_shot;

  if (projected.shot_mode_attempts > modeLimit) {
    return decision(
      false,
      'RENDER_ATTEMPT_LIMIT_REACHED',
      'This shot reached its ' + args.mode + ' render-attempt ceiling.'
    );
  }

  const anyMoneyPolicy =
    policy.max_estimated_cost_per_shot_usd !== null ||
    policy.max_estimated_cost_per_project_usd !== null ||
    policy.approval_required_over_usd !== null;

  if (anyMoneyPolicy && args.estimatedCostUsd === null) {
    return decision(
      false,
      'RENDER_COST_ESTIMATE_REQUIRED',
      'A cost estimate is required before this render can enter a project with monetary guardrails.'
    );
  }

  if (
    policy.max_estimated_cost_per_shot_usd !== null &&
    projected.shot_cost_usd > policy.max_estimated_cost_per_shot_usd
  ) {
    return decision(
      false,
      'RENDER_SHOT_BUDGET_EXCEEDED',
      'This attempt would push the shot beyond its configured cost ceiling.'
    );
  }

  if (
    policy.max_estimated_cost_per_project_usd !== null &&
    projected.project_cost_usd > policy.max_estimated_cost_per_project_usd
  ) {
    return decision(
      false,
      'RENDER_PROJECT_BUDGET_EXCEEDED',
      'This attempt would push the production beyond its configured project render budget.'
    );
  }

  if (
    policy.approval_required_over_usd !== null &&
    args.estimatedCostUsd !== null &&
    args.estimatedCostUsd > policy.approval_required_over_usd &&
    !args.humanApproved
  ) {
    return decision(
      false,
      'RENDER_COST_APPROVAL_REQUIRED',
      'This single render exceeds the human-approval threshold.',
      true
    );
  }

  return decision(true, 'OK', 'The proposed render is within the configured attempt and cost guardrails.');
}

export async function readRenderBudgetPolicy(projectId: string) {
  const authoritative = await readAuthoritativeProjectState<RenderBudgetPolicy>(
    projectId,
    'render-budget:policy'
  );
  return authoritative?.value
    ? normalizeRenderBudgetPolicy(projectId, authoritative.value)
    : defaultRenderBudgetPolicy(projectId);
}

export async function evaluateProposedRenderAttempt(args: {
  projectId: string;
  storyVersion: string;
  shotId: string;
  mode: 'draft' | 'final';
  estimatedCostUsd: number | null;
  humanApproved?: boolean;
}) {
  const [policy, events] = await Promise.all([
    readRenderBudgetPolicy(args.projectId),
    listProjectAttemptEvents({
      projectId: args.projectId,
      storyVersion: args.storyVersion,
      limit: 2000
    })
  ]);

  const summary = summarizeRenderBudget({
    projectId: args.projectId,
    storyVersion: args.storyVersion,
    events
  });

  return evaluateRenderBudget({
    policy,
    summary,
    shotId: args.shotId,
    mode: args.mode,
    estimatedCostUsd: args.estimatedCostUsd,
    humanApproved: args.humanApproved
  });
}
