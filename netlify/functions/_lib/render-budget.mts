import { readAuthoritativeProjectState } from './project-artifacts.mts';
import { listProjectAttemptEvents } from './render-store.mts';
import {
  defaultRenderBudgetPolicy,
  evaluateRenderBudget,
  normalizeRenderBudgetPolicy,
  summarizeRenderBudget,
  type RenderBudgetDecision,
  type RenderBudgetPolicy,
  type RenderBudgetSummary
} from './render-budget-core.mts';

export {
  defaultRenderBudgetPolicy,
  evaluateRenderBudget,
  normalizeRenderBudgetPolicy,
  summarizeRenderBudget,
  type RenderBudgetDecision,
  type RenderBudgetPolicy,
  type RenderBudgetSummary
};

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
