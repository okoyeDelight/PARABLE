import { getDeployStore, getStore } from '@netlify/blobs';
import type { RenderAttempt, RenderQAReport, ShotRenderSpec } from './render-foundation.mts';

function stores() {
  const production = Netlify.context?.deploy?.context === 'production';
  const make = (name: string) => production
    ? getStore(name, { consistency: 'strong' })
    : getDeployStore(name);

  return {
    specs: make('parable-render-specs'),
    attempts: make('parable-render-attempts'),
    attemptEvents: make('parable-render-attempt-events'),
    qa: make('parable-render-qa'),
    keyframes: make('parable-keyframe-plans')
  };
}

const safe = (value: string) => String(value || '')
  .replace(/[^a-zA-Z0-9_.:-]/g, '_')
  .slice(0, 160);

function specKey(spec: Pick<ShotRenderSpec, 'project_id' | 'story_version' | 'scene_id' | 'shot_id' | 'spec_hash'>) {
  return [
    'project', safe(spec.project_id),
    safe(spec.story_version),
    safe(spec.scene_id),
    safe(spec.shot_id),
    safe(spec.spec_hash)
  ].join('/');
}

export async function saveRenderSpec(spec: ShotRenderSpec) {
  const key = specKey(spec);
  await stores().specs.setJSON(key, spec, { onlyIfNew: true } as any);
  await stores().specs.setJSON(
    ['latest', safe(spec.project_id), safe(spec.story_version), safe(spec.scene_id), safe(spec.shot_id)].join('/'),
    spec
  );
  return key;
}

export async function readRenderSpec(args: {
  projectId: string;
  storyVersion: string;
  sceneId: string;
  shotId: string;
  specHash?: string | null;
}) {
  const key = args.specHash
    ? ['project', safe(args.projectId), safe(args.storyVersion), safe(args.sceneId), safe(args.shotId), safe(args.specHash)].join('/')
    : ['latest', safe(args.projectId), safe(args.storyVersion), safe(args.sceneId), safe(args.shotId)].join('/');
  return stores().specs.get(key, { type: 'json' }) as Promise<ShotRenderSpec | null>;
}

function attemptKey(attemptId: string) {
  return 'attempt/' + safe(attemptId);
}

export async function saveRenderAttempt(attempt: RenderAttempt) {
  await stores().attempts.setJSON(attemptKey(attempt.id), attempt);
  await stores().attempts.setJSON(
    ['latest', safe(attempt.project_id), safe(attempt.story_version), safe(attempt.scene_id), safe(attempt.shot_id)].join('/'),
    attempt
  );
  await appendRenderAttemptEvent(attempt, 'snapshot');
  return attempt;
}

export async function readRenderAttempt(attemptId: string) {
  return stores().attempts.get(attemptKey(attemptId), { type: 'json' }) as Promise<RenderAttempt | null>;
}

export async function appendRenderAttemptEvent(attempt: RenderAttempt, eventType: string, metadata: Record<string, unknown> = {}) {
  const at = new Date().toISOString();
  const key = [
    'event',
    safe(attempt.project_id),
    safe(attempt.story_version),
    safe(attempt.scene_id),
    safe(attempt.shot_id),
    at.replace(/[:.]/g, '-'),
    crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  ].join('/');

  await stores().attemptEvents.setJSON(key, {
    event_version: 'parable-render-attempt-event-v1',
    event_type: safe(eventType),
    attempt_id: attempt.id,
    project_id: attempt.project_id,
    story_version: attempt.story_version,
    scene_id: attempt.scene_id,
    shot_id: attempt.shot_id,
    status: attempt.status,
    provider: attempt.provider,
    model: attempt.model,
    spec_hash: attempt.spec_hash,
    mode: attempt.mode,
    estimated_cost_usd: attempt.estimated_cost_usd,
    actual_cost_usd: attempt.actual_cost_usd,
    metadata,
    at
  });
}

export async function listShotAttempts(args: {
  projectId: string;
  storyVersion: string;
  sceneId: string;
  shotId: string;
  limit?: number;
}) {
  const prefix = [
    'event',
    safe(args.projectId),
    safe(args.storyVersion),
    safe(args.sceneId),
    safe(args.shotId)
  ].join('/') + '/';

  const { blobs } = await stores().attemptEvents.list({ prefix });
  const latest = blobs.slice(-Math.max(1, Math.min(200, args.limit || 80)));
  const events = await Promise.all(
    latest.map(({ key }) => stores().attemptEvents.get(key, { type: 'json' }))
  );

  return events.filter(Boolean);
}

export async function saveRenderQA(report: RenderQAReport, attempt: RenderAttempt) {
  const key = ['attempt', safe(attempt.id), report.evaluated_at.replace(/[:.]/g, '-')].join('/');
  await stores().qa.setJSON(key, report);
  await stores().qa.setJSON('latest/' + safe(attempt.id), report);
  return key;
}

export async function readLatestRenderQA(attemptId: string) {
  return stores().qa.get('latest/' + safe(attemptId), { type: 'json' }) as Promise<RenderQAReport | null>;
}


export async function saveKeyframePlan(plan: Record<string, any>) {
  const key = [
    'project',
    safe(plan.project_id),
    safe(plan.story_version),
    safe(plan.scene_id),
    safe(plan.shot_id),
    safe(plan.spec_hash)
  ].join('/');
  await stores().keyframes.setJSON(key, plan, { onlyIfNew: true } as any);
  await stores().keyframes.setJSON(
    ['latest', safe(plan.project_id), safe(plan.story_version), safe(plan.scene_id), safe(plan.shot_id)].join('/'),
    plan
  );
  return key;
}

export async function readKeyframePlan(args: {
  projectId: string;
  storyVersion: string;
  sceneId: string;
  shotId: string;
  specHash?: string | null;
}) {
  const key = args.specHash
    ? ['project', safe(args.projectId), safe(args.storyVersion), safe(args.sceneId), safe(args.shotId), safe(args.specHash)].join('/')
    : ['latest', safe(args.projectId), safe(args.storyVersion), safe(args.sceneId), safe(args.shotId)].join('/');
  return stores().keyframes.get(key, { type: 'json' }) as Promise<Record<string, any> | null>;
}


export async function listProjectAttemptEvents(args: {
  projectId: string;
  storyVersion?: string | null;
  limit?: number;
}) {
  const prefix = args.storyVersion
    ? ['event', safe(args.projectId), safe(args.storyVersion)].join('/') + '/'
    : ['event', safe(args.projectId)].join('/') + '/';

  const { blobs } = await stores().attemptEvents.list({ prefix });
  const latest = blobs.slice(-Math.max(1, Math.min(2000, args.limit || 1000)));
  const events = await Promise.all(
    latest.map(({ key }) => stores().attemptEvents.get(key, { type: 'json' }))
  );
  return events.filter(Boolean) as Record<string, any>[];
}
