export type RightsEnforcementMode = 'strict' | 'observe';

export function parseRightsEnforcementMode(value: unknown): RightsEnforcementMode {
  return String(value || '').trim().toLowerCase() === 'observe' ? 'observe' : 'strict';
}

export function runtimeRightsEnforcementMode(): RightsEnforcementMode {
  try {
    return parseRightsEnforcementMode(Netlify.env.get('PARABLE_RIGHTS_ENFORCEMENT_MODE'));
  } catch {
    return 'strict';
  }
}

export function referenceAllowedForRender(args: {
  rightsStatus: string;
  approvedByHuman: boolean;
  mode?: RightsEnforcementMode;
}) {
  const mode = args.mode || runtimeRightsEnforcementMode();
  const status = String(args.rightsStatus || '').trim().toLowerCase();

  if (!args.approvedByHuman) return false;
  if (status === 'revoked') return false;
  if (mode === 'observe') return true;
  return status === 'approved';
}

export function evaluateRightsEnforcement(args: {
  rightsStatus: string;
  blockers: string[];
  mode?: RightsEnforcementMode;
}) {
  const mode = args.mode || runtimeRightsEnforcementMode();
  const status = String(args.rightsStatus || '').trim().toLowerCase();
  const explicitlyRevoked = status === 'revoked';

  return {
    mode,
    allowed: explicitlyRevoked ? false : (mode === 'observe' ? true : args.blockers.length === 0),
    muted: mode === 'observe' && !explicitlyRevoked && args.blockers.length > 0,
    explicitly_revoked: explicitlyRevoked
  };
}
