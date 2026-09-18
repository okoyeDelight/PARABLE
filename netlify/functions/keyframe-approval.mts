import {
  acquireProjectMutation,
  abortProjectMutation,
  commitProjectMutation,
  projectMutationErrorResponse,
  type ProjectMutationLease
} from './_lib/project-concurrency.mts';
import {
  readAuthoritativeProjectState,
  stageProjectArtifact
} from './_lib/project-artifacts.mts';
import {
  keyframeApprovalStateKey,
  readKeyframeApproval
} from './_lib/keyframe-approval.mts';
import {
  allKeyframeChecksPassed,
  normalizeKeyframeChecks,
  validContentSha256,
  type KeyframeApproval
} from './_lib/keyframe-approval-core.mts';
import { stableHash } from './_lib/render-foundation.mts';
import { readKeyframePlan, readRenderSpec } from './_lib/render-store.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 1800) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(value);
const safeHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol);
  } catch {
    return false;
  }
};

export default async (request: Request) => {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = clean(url.searchParams.get('projectId'), 96);
    const sceneId = clean(url.searchParams.get('sceneId'), 96);
    const shotId = clean(url.searchParams.get('shotId'), 96);

    if (![projectId, sceneId, shotId].every((value) => value && safeId(value))) {
      return json({ error: 'Valid projectId, sceneId and shotId are required.' }, 400);
    }

    const state = await readKeyframeApproval(projectId, sceneId, shotId);
    if (!state) {
      return json({
        status: 'missing',
        project_id: projectId,
        scene_id: sceneId,
        shot_id: shotId,
        approval: null
      }, 404);
    }

    return json({
      status: state.value.status,
      approval: state.value,
      project_revision: state.revision,
      authoritative_ref: state.ref
    });
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = clean(body.projectId, 96);
  const storyVersion = clean(body.storyVersion, 96);
  const sceneId = clean(body.sceneId, 96);
  const shotId = clean(body.shotId, 96);
  const specHash = clean(body.specHash, 96);
  const action = clean(body.action || 'approve', 40);

  if (![projectId, storyVersion, sceneId, shotId, specHash].every((value) => value && safeId(value))) {
    return json({ error: 'Valid projectId, storyVersion, sceneId, shotId and specHash are required.' }, 400);
  }

  if (!['approve', 'revoke'].includes(action)) {
    return json({ error: 'action must be approve or revoke.' }, 400);
  }

  if (body.humanApproved !== true) {
    return json({
      error: 'Keyframe approval changes require humanApproved: true.',
      code: 'HUMAN_APPROVAL_REQUIRED'
    }, 400);
  }

  const [spec, plan] = await Promise.all([
    readRenderSpec({ projectId, storyVersion, sceneId, shotId, specHash }),
    readKeyframePlan({ projectId, storyVersion, sceneId, shotId, specHash })
  ]);

  if (!spec) return json({ error: 'The exact ShotRenderSpec was not found.' }, 404);
  if (!plan) return json({ error: 'Build the keyframe plan before approving a first frame.' }, 409);
  if (String(plan.spec_hash || '') !== spec.spec_hash) {
    return json({
      error: 'The keyframe plan does not match this ShotRenderSpec.',
      code: 'KEYFRAME_PLAN_SPEC_MISMATCH'
    }, 409);
  }

  let lease: ProjectMutationLease | null = null;
  try {
    lease = await acquireProjectMutation({
      projectId,
      mutationType: 'keyframe-' + action,
      expectedRevision: Number.isFinite(Number(body.expectedProjectRevision))
        ? Number(body.expectedProjectRevision)
        : null,
      ttlMs: 30000
    });

    const current = await readKeyframeApproval(projectId, sceneId, shotId);
    const planHash = await stableHash({
      spec_hash: plan.spec_hash,
      first_frame: plan.first_frame,
      anchors: plan.anchors,
      acceptance_checklist: plan.acceptance_checklist
    });

    let approval: KeyframeApproval;

    if (action === 'revoke') {
      if (!current?.value || current.value.status !== 'approved') {
        await abortProjectMutation(lease).catch(() => false);
        return json({
          error: 'There is no active first-frame approval to revoke.',
          code: 'KEYFRAME_APPROVAL_NOT_ACTIVE'
        }, 409);
      }

      approval = {
        ...current.value,
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revoke_reason: clean(body.reason, 800) || 'Revoked by human reviewer.'
      };
    } else {
      const assetUri = clean(body.assetUri, 1800);
      const assetSource = clean(body.assetSource || 'generated', 40);
      const contentSha256 = clean(body.contentSha256, 64).toLowerCase() || null;
      const immutableBinding = body.immutableBinding === true;
      const checks = normalizeKeyframeChecks(body.checks);

      if (!assetUri || !safeHttpUrl(assetUri)) {
        await abortProjectMutation(lease).catch(() => false);
        return json({ error: 'A valid http(s) first-frame assetUri is required.' }, 400);
      }

      if (!['generated', 'uploaded', 'external'].includes(assetSource)) {
        await abortProjectMutation(lease).catch(() => false);
        return json({ error: 'assetSource must be generated, uploaded or external.' }, 400);
      }

      if (contentSha256 && !validContentSha256(contentSha256)) {
        await abortProjectMutation(lease).catch(() => false);
        return json({ error: 'contentSha256 must be a 64-character SHA-256 digest.' }, 400);
      }

      if (!immutableBinding && !contentSha256) {
        await abortProjectMutation(lease).catch(() => false);
        return json({
          error: 'The approved first frame must be immutably bound. Supply contentSha256 or immutableBinding: true.',
          code: 'KEYFRAME_ASSET_BINDING_REQUIRED'
        }, 409);
      }

      if (!allKeyframeChecksPassed(checks)) {
        await abortProjectMutation(lease).catch(() => false);
        return json({
          error: 'Every first-frame canon check must be explicitly confirmed before approval.',
          code: 'KEYFRAME_CHECKS_INCOMPLETE',
          checks
        }, 409);
      }

      approval = {
        approval_version: 'parable-keyframe-approval-v1',
        status: 'approved',
        project_id: projectId,
        story_version: storyVersion,
        scene_id: sceneId,
        shot_id: shotId,
        spec_hash: spec.spec_hash,
        keyframe_plan_hash: planHash,
        asset: {
          uri: assetUri,
          source: assetSource as 'generated' | 'uploaded' | 'external',
          provider: clean(body.provider, 120) || null,
          model: clean(body.model, 240) || null,
          content_sha256: contentSha256,
          immutable_binding: immutableBinding || Boolean(contentSha256)
        },
        checks,
        reviewer: {
          human_approved: true,
          note: clean(body.note, 1000) || null
        },
        approved_at: new Date().toISOString(),
        revoked_at: null,
        revoke_reason: null
      };
    }

    const ref = await stageProjectArtifact({
      projectId,
      mutationId: lease.mutation_id,
      kind: 'keyframe-approval',
      artifactId: sceneId + ':' + shotId + ':' + spec.spec_hash.slice(0, 16),
      value: approval
    });

    const committed = await commitProjectMutation(
      lease,
      {
        action,
        story_version: storyVersion,
        scene_id: sceneId,
        shot_id: shotId,
        spec_hash: spec.spec_hash,
        keyframe_status: approval.status,
        keyframe_plan_hash: approval.keyframe_plan_hash
      },
      { [keyframeApprovalStateKey(sceneId, shotId)]: ref }
    );

    return json({
      approval,
      project_revision: committed.revision,
      mutation_id: committed.mutation_id,
      authoritative_ref: ref,
      final_motion_gate: approval.status === 'approved' ? 'unlocked-for-this-spec' : 'blocked'
    }, action === 'approve' ? 201 : 200);
  } catch (error) {
    if (lease) await abortProjectMutation(lease).catch(() => false);
    const handled = projectMutationErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }
};

export const config = {
  path: '/api/keyframe-approval',
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
