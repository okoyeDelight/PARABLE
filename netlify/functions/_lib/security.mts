import { getStore } from '@netlify/blobs';
import { getContext } from '@netlify/functions';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export type ParableRole = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer';

export type ProjectAction =
  | 'project:read'
  | 'project:create'
  | 'project:edit'
  | 'project:delete'
  | 'members:manage'
  | 'rights:approve'
  | 'review:approve'
  | 'review:override'
  | 'render:plan'
  | 'render:spend'
  | 'render:budget'
  | 'audit:read';

export type SecurityActor = {
  actor_id: string;
  provider: string;
  subject: string;
  email: string | null;
  display_name: string | null;
  auth_mode: 'jwt' | 'preview-owner' | 'internal';
  internal: boolean;
};

export type ProjectAccessRecord = {
  access_version: 'parable-project-access-v1';
  project_id: string;
  workspace_id: string;
  owner_actor_id: string;
  members: Record<string, {
    role: ParableRole;
    status: 'active' | 'revoked';
    added_at: string;
    updated_at: string;
  }>;
  created_at: string;
  updated_at: string;
};

export type AuthorizedProjectContext = {
  actor: SecurityActor;
  project_id: string;
  workspace_id: string;
  role: ParableRole;
  action: ProjectAction;
  preview_mode: boolean;
};

export class SecurityError extends Error {
  code: string;
  status: number;
  detail?: Record<string, unknown>;

  constructor(code: string, message: string, status = 403, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function runtime() {
  let context: any = null;
  try { context = getContext(); } catch {}
  const deployContext = context?.deploy?.context || Netlify.context?.deploy?.context || 'unknown';
  const deployId = String(context?.deploy?.id || Netlify.context?.deploy?.id || 'local')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 96);

  return {
    production: deployContext === 'production',
    deploy_context: deployContext,
    deploy_id: deployId || 'local',
    prefix: deployContext === 'production' ? '' : 'deploy/' + (deployId || 'local') + '/'
  };
}

function stores() {
  const scope = runtime();
  const suffix = scope.production ? '' : '-sandbox';
  return {
    scope,
    access: getStore('parable-project-access' + suffix, { consistency: 'strong' }),
    audit: getStore('parable-security-audit' + suffix, { consistency: 'strong' })
  };
}

const clean = (value: unknown, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_.:@-]{1,180}$/.test(value);

function accessKey(projectId: string) {
  const { scope } = stores();
  return scope.prefix + 'project/' + projectId + '/access';
}

function roleAllows(role: ParableRole, action: ProjectAction) {
  const matrix: Record<ParableRole, ProjectAction[]> = {
    owner: [
      'project:read','project:create','project:edit','project:delete',
      'members:manage','rights:approve','review:approve','review:override',
      'render:plan','render:spend','render:budget','audit:read'
    ],
    admin: [
      'project:read','project:create','project:edit',
      'members:manage','rights:approve','review:approve','review:override',
      'render:plan','render:spend','render:budget','audit:read'
    ],
    editor: [
      'project:read','project:create','project:edit','render:plan','render:spend'
    ],
    reviewer: [
      'project:read','review:approve','review:override','render:plan'
    ],
    viewer: ['project:read']
  };
  return matrix[role].includes(action);
}

function base64urlEncode(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(data: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return new Uint8Array(signature);
}

async function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function internalSecret() {
  const dedicated = String(Netlify.env.get('PARABLE_INTERNAL_AUTH_SECRET') || '').trim();
  if (dedicated) return dedicated;

  // Deploy-preview compatibility only: derive an internal signing key from an
  // already-secret server credential so browser callers cannot forge worker auth.
  // Production still reports this as a hardening requirement until a dedicated
  // PARABLE_INTERNAL_AUTH_SECRET is configured.
  const scope = runtime();
  if (!scope.production) {
    const seed = String(
      Netlify.env.get('OPENROUTER_API_KEY') ||
      Netlify.env.get('FAL_KEY') ||
      ''
    ).trim();
    if (seed) return 'parable-internal-preview-v1|' + seed;
  }

  return '';
}

export function internalAuthUsesDedicatedSecret() {
  return Boolean(String(Netlify.env.get('PARABLE_INTERNAL_AUTH_SECRET') || '').trim());
}

export async function signInternalAuthorization(args: {
  actor: SecurityActor;
  projectId: string;
  action: ProjectAction;
  ttlSeconds?: number;
}) {
  const secret = internalSecret();
  if (!secret) {
    throw new SecurityError(
      'INTERNAL_AUTH_NOT_CONFIGURED',
      'PARABLE internal authorization signing is not configured.',
      503
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    actor: {
      actor_id: args.actor.actor_id,
      provider: args.actor.provider,
      subject: args.actor.subject,
      email: args.actor.email,
      display_name: args.actor.display_name
    },
    project_id: args.projectId,
    action: args.action,
    iat: now,
    exp: now + Math.max(30, Math.min(900, Math.floor(args.ttlSeconds || 300))),
    nonce: crypto.randomUUID()
  };

  const encoded = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = base64urlEncode(await hmac(encoded, secret));
  return encoded + '.' + signature;
}

async function verifyInternalAuthorization(value: string) {
  const secret = internalSecret();
  if (!secret) return null;

  const parts = value.split('.');
  if (parts.length !== 2) return null;

  let expected: Uint8Array;
  let supplied: Uint8Array;
  try {
    expected = await hmac(parts[0], secret);
    supplied = base64urlDecode(parts[1]);
  } catch {
    return null;
  }

  if (!(await timingSafeEqual(expected, supplied))) return null;

  let payload: any;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[0])));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload?.v !== 1 || !payload?.exp || Number(payload.exp) < now || Number(payload.iat) > now + 60) {
    return null;
  }

  const actorId = clean(payload?.actor?.actor_id, 180);
  const projectId = clean(payload?.project_id, 96);
  const action = clean(payload?.action, 80) as ProjectAction;
  if (!actorId || !projectId || !action) return null;

  const actor: SecurityActor = {
    actor_id: actorId,
    provider: clean(payload?.actor?.provider, 80) || 'internal',
    subject: clean(payload?.actor?.subject, 180) || actorId,
    email: clean(payload?.actor?.email, 240) || null,
    display_name: clean(payload?.actor?.display_name, 240) || null,
    auth_mode: 'internal',
    internal: true
  };

  return {
    actor,
    project_id: projectId,
    action
  };
}

let jwksCache: { url: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;

async function authenticateJwt(request: Request): Promise<SecurityActor> {
  const auth = String(request.headers.get('authorization') || '');
  if (!auth.startsWith('Bearer ')) {
    throw new SecurityError('AUTH_REQUIRED', 'Sign in to PARABLE before accessing this production.', 401);
  }

  const token = auth.slice(7).trim();
  const jwksUrl = String(Netlify.env.get('PARABLE_JWKS_URL') || '').trim();
  const issuer = String(Netlify.env.get('PARABLE_JWT_ISSUER') || '').trim();
  const audience = String(Netlify.env.get('PARABLE_JWT_AUDIENCE') || '').trim();

  if (!jwksUrl || !issuer) {
    throw new SecurityError(
      'AUTH_NOT_CONFIGURED',
      'PARABLE production authentication is not fully configured.',
      503
    );
  }

  if (!jwksCache || jwksCache.url !== jwksUrl) {
    jwksCache = {
      url: jwksUrl,
      set: createRemoteJWKSet(new URL(jwksUrl))
    };
  }

  let verified: any;
  try {
    verified = await jwtVerify(token, jwksCache.set, {
      issuer,
      ...(audience ? { audience } : {}),
      clockTolerance: 10
    });
  } catch {
    throw new SecurityError('AUTH_INVALID', 'Your PARABLE session is invalid or expired.', 401);
  }

  const subject = clean(verified.payload?.sub, 180);
  if (!subject || !safeId(subject)) {
    throw new SecurityError('AUTH_SUBJECT_INVALID', 'The authenticated identity has no usable subject.', 401);
  }

  const provider = clean(
    verified.payload?.iss || Netlify.env.get('PARABLE_IDENTITY_PROVIDER') || 'jwt',
    120
  );

  return {
    actor_id: 'usr_' + subject,
    provider,
    subject,
    email: clean(verified.payload?.email, 240).toLowerCase() || null,
    display_name: clean(
      verified.payload?.name || verified.payload?.user_metadata?.full_name || verified.payload?.user_metadata?.name,
      240
    ) || null,
    auth_mode: 'jwt',
    internal: false
  };
}

export async function authenticateRequest(request: Request): Promise<SecurityActor> {
  const internal = clean(request.headers.get('x-parable-internal-auth'), 5000);
  if (internal) {
    const verified = await verifyInternalAuthorization(internal);
    if (!verified) {
      throw new SecurityError('INTERNAL_AUTH_INVALID', 'Internal PARABLE authorization was invalid.', 401);
    }
    return verified.actor;
  }

  const scope = runtime();
  const configured = String(Netlify.env.get('PARABLE_AUTH_MODE') || '').trim().toLowerCase();

  if (scope.production) {
    if (configured !== 'jwt') {
      throw new SecurityError(
        'SECURITY_GATE_CLOSED',
        'PARABLE production is fail-closed until JWT authentication is configured.',
        503
      );
    }
    return authenticateJwt(request);
  }

  if (configured === 'jwt') return authenticateJwt(request);

  // Engineering-only deploy previews retain a single owner persona so the product
  // can be built and tested before a public identity provider is provisioned.
  return {
    actor_id: 'usr_preview_owner',
    provider: 'parable-preview',
    subject: 'preview-owner',
    email: null,
    display_name: 'PARABLE Preview Owner',
    auth_mode: 'preview-owner',
    internal: false
  };
}

export async function readProjectAccess(projectId: string) {
  const { access } = stores();
  return access.get(accessKey(projectId), { type: 'json' }) as Promise<ProjectAccessRecord | null>;
}

export async function createProjectAccess(projectId: string, actor: SecurityActor, workspaceId?: string | null) {
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(projectId)) {
    throw new SecurityError('PROJECT_ID_INVALID', 'Invalid project id.', 400);
  }

  const { access } = stores();
  const current = await readProjectAccess(projectId);
  if (current) return current;

  const now = new Date().toISOString();
  const workspace = clean(workspaceId, 96) || ('ws_' + actor.actor_id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 72));
  const record: ProjectAccessRecord = {
    access_version: 'parable-project-access-v1',
    project_id: projectId,
    workspace_id: workspace,
    owner_actor_id: actor.actor_id,
    members: {
      [actor.actor_id]: {
        role: 'owner',
        status: 'active',
        added_at: now,
        updated_at: now
      }
    },
    created_at: now,
    updated_at: now
  };

  await access.setJSON(accessKey(projectId), record, { onlyIfNew: true } as any);
  return (await readProjectAccess(projectId)) || record;
}

async function recordAudit(args: {
  request: Request;
  actor: SecurityActor | null;
  projectId: string;
  workspaceId: string | null;
  action: ProjectAction;
  role: ParableRole | null;
  outcome: 'allowed' | 'denied';
  code?: string | null;
}) {
  try {
    const { audit, scope } = stores();
    const now = new Date().toISOString();
    const id = 'audit_' + crypto.randomUUID().replaceAll('-', '');
    const key = [
      scope.prefix + 'project',
      args.projectId,
      now.slice(0, 10),
      now.replace(/[:.]/g, '-') + '-' + id.slice(-12)
    ].join('/');

    await audit.setJSON(key, {
      audit_version: 'parable-security-audit-v1',
      id,
      project_id: args.projectId,
      workspace_id: args.workspaceId,
      actor_id: args.actor?.actor_id || null,
      actor_provider: args.actor?.provider || null,
      action: args.action,
      role: args.role,
      outcome: args.outcome,
      code: args.code || null,
      request_id: clean(
        args.request.headers.get('x-nf-request-id') ||
        args.request.headers.get('x-request-id'),
        180
      ) || null,
      at: now
    });
  } catch {
    // Authorization must not depend on audit storage availability.
  }
}

export async function authorizeProject(
  request: Request,
  projectId: string,
  action: ProjectAction
): Promise<AuthorizedProjectContext> {
  const id = clean(projectId, 96);
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(id)) {
    throw new SecurityError('PROJECT_ID_INVALID', 'Invalid project id.', 400);
  }

  let actor: SecurityActor | null = null;
  let record: ProjectAccessRecord | null = null;
  try {
    actor = await authenticateRequest(request);

    const internalToken = clean(request.headers.get('x-parable-internal-auth'), 5000);
    if (internalToken) {
      const trusted = await verifyInternalAuthorization(internalToken);
      if (!trusted || trusted.project_id !== id || trusted.action !== action) {
        throw new SecurityError(
          'INTERNAL_AUTH_SCOPE_MISMATCH',
          'Internal authorization does not match this project/action.',
          403
        );
      }
    }

    record = await readProjectAccess(id);
    const scope = runtime();

    if (!record && !scope.production && actor.auth_mode === 'preview-owner') {
      record = await createProjectAccess(id, actor);
    }

    if (!record) {
      throw new SecurityError(
        'PROJECT_ACCESS_NOT_INITIALIZED',
        'This project has no active PARABLE access boundary.',
        403
      );
    }

    const membership = record.members[actor.actor_id];
    if (!membership || membership.status !== 'active') {
      throw new SecurityError('PROJECT_ACCESS_DENIED', 'You do not have access to this PARABLE project.', 403);
    }

    if (!roleAllows(membership.role, action)) {
      throw new SecurityError(
        'PROJECT_ACTION_DENIED',
        'Your project role does not permit this action.',
        403,
        { role: membership.role, action }
      );
    }

    await recordAudit({
      request,
      actor,
      projectId: id,
      workspaceId: record.workspace_id,
      action,
      role: membership.role,
      outcome: 'allowed'
    });

    return {
      actor,
      project_id: id,
      workspace_id: record.workspace_id,
      role: membership.role,
      action,
      preview_mode: actor.auth_mode === 'preview-owner'
    };
  } catch (error) {
    const security = error instanceof SecurityError
      ? error
      : new SecurityError('SECURITY_ERROR', 'PARABLE could not verify project access.', 500);

    await recordAudit({
      request,
      actor,
      projectId: id,
      workspaceId: record?.workspace_id || null,
      action,
      role: actor && record?.members?.[actor.actor_id]?.role || null,
      outcome: 'denied',
      code: security.code
    });

    throw security;
  }
}

export async function authorizeProjectCreation(request: Request) {
  return authenticateRequest(request);
}

export function securityErrorResponse(error: unknown) {
  if (!(error instanceof SecurityError)) return null;
  return {
    status: error.status,
    body: {
      error: error.message,
      code: error.code,
      ...(error.detail ? { detail: error.detail } : {})
    }
  };
}

export async function listAccessibleProjectIds(request: Request) {
  const actor = await authenticateRequest(request);
  const { access, scope } = stores();
  const ids: string[] = [];
  const prefix = scope.prefix + 'project/';
  const pages = access.list({ prefix, paginate: true });

  for await (const page of pages as AsyncIterable<{ blobs: { key: string }[] }>) {
    for (const blob of page.blobs) {
      if (!blob.key.endsWith('/access')) continue;
      const record = await access.get(blob.key, { type: 'json' }) as ProjectAccessRecord | null;
      if (!record) continue;
      const member = record.members[actor.actor_id];
      if (member?.status === 'active') ids.push(record.project_id);
    }
  }

  return { actor, project_ids: ids };
}

export async function updateProjectMember(args: {
  request: Request;
  projectId: string;
  targetActorId: string;
  role: ParableRole;
  status: 'active' | 'revoked';
}) {
  const context = await authorizeProject(args.request, args.projectId, 'members:manage');
  const { access } = stores();
  const current = await readProjectAccess(args.projectId);
  if (!current) throw new SecurityError('PROJECT_ACCESS_NOT_INITIALIZED', 'Project access record not found.', 404);

  if (args.targetActorId === current.owner_actor_id && args.status === 'revoked') {
    throw new SecurityError('OWNER_CANNOT_BE_REVOKED', 'Transfer ownership before revoking the project owner.', 409);
  }
  if (args.targetActorId === current.owner_actor_id && args.role !== 'owner') {
    throw new SecurityError('OWNER_ROLE_IMMUTABLE', 'Transfer ownership before changing the owner role.', 409);
  }
  if (args.role === 'owner' && args.targetActorId !== current.owner_actor_id) {
    throw new SecurityError('OWNER_TRANSFER_REQUIRED', 'Use an explicit ownership-transfer workflow.', 409);
  }

  const now = new Date().toISOString();
  const next: ProjectAccessRecord = {
    ...current,
    members: {
      ...current.members,
      [args.targetActorId]: {
        role: args.role,
        status: args.status,
        added_at: current.members[args.targetActorId]?.added_at || now,
        updated_at: now
      }
    },
    updated_at: now
  };

  await access.setJSON(accessKey(args.projectId), next);
  return { context, access: next };
}

export async function listProjectAudit(request: Request, projectId: string, limit = 100) {
  await authorizeProject(request, projectId, 'audit:read');
  const { audit, scope } = stores();
  const prefix = scope.prefix + 'project/' + projectId + '/';
  const { blobs } = await audit.list({ prefix });
  const selected = blobs.slice(-Math.max(1, Math.min(500, limit)));
  const rows = await Promise.all(
    selected.map(({ key }) => audit.get(key, { type: 'json' }) as Promise<Record<string, unknown> | null>)
  );
  return rows.filter(Boolean).sort((a: any, b: any) => String(b.at).localeCompare(String(a.at)));
}
