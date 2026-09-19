import { readAuthoritativeProjectState } from './project-artifacts.mts';
import {
  evaluateKeyframeGate,
  type KeyframeApproval,
  type KeyframeGateDecision
} from './keyframe-approval-core.mts';

export {
  evaluateKeyframeGate,
  type KeyframeApproval,
  type KeyframeGateDecision
};

export function keyframeApprovalStateKey(sceneId: string, shotId: string) {
  return 'keyframe:approved:' + sceneId + ':' + shotId;
}

export async function readKeyframeApproval(
  projectId: string,
  sceneId: string,
  shotId: string
) {
  const state = await readAuthoritativeProjectState<KeyframeApproval>(
    projectId,
    keyframeApprovalStateKey(sceneId, shotId)
  );
  return state || null;
}

export async function evaluateStoredKeyframeGate(args: {
  projectId: string;
  sceneId: string;
  shotId: string;
  specHash: string;
}) {
  const stored = await readKeyframeApproval(args.projectId, args.sceneId, args.shotId);
  const decision = evaluateKeyframeGate(stored?.value || null, args.specHash);
  return {
    ...decision,
    project_revision: stored?.revision ?? null,
    authoritative_ref: stored?.ref ?? null
  };
}
