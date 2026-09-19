import { getStore } from '@netlify/blobs';
import { getContext } from '@netlify/functions';
import {
  bootstrapTransactionalProjectState,
  commitTransactionalProjectMutation,
  readTransactionalProjectState,
  transactionalStateMode,
  TransactionalStateError
} from './transactional-state.mts';

type LeaseState = {
  mutation_id: string;
  mutation_type: string;
  acquired_at: string;
  expires_at: string;
};

type ProjectHead = {
  version: 'parable-project-head-v2';
  project_id: string;
  revision: number;
  active_lease: LeaseState | null;
  last_mutation_id: string | null;
  last_mutation_type: string | null;
  state_refs: Record<string, string>;
  updated_at: string;
};

export type ProjectMutationLease = {
  project_id: string;
  mutation_id: string;
  mutation_type: string;
  base_revision: number;
  expires_at: string;
  backend: 'postgres' | 'blobs';
};

export class ProjectRevisionConflict extends Error {
  code = 'PROJECT_REVISION_CONFLICT';
  currentRevision: number;
  expectedRevision: number | null;

  constructor(message: string, currentRevision: number, expectedRevision: number | null) {
    super(message);
    this.name = 'ProjectRevisionConflict';
    this.currentRevision = currentRevision;
    this.expectedRevision = expectedRevision;
  }
}

export class ProjectMutationBusy extends Error {
  code = 'PROJECT_MUTATION_BUSY';
  retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'ProjectMutationBusy';
    this.retryAfterMs = retryAfterMs;
  }
}

function runtimeScope() {
  let context: any = null;
  try { context = getContext(); } catch {}
  const deployContext = context?.deploy?.context || Netlify.context?.deploy?.context || 'unknown';
  if (deployContext === 'production') return { production: true, prefix: '' };

  const deployId = String(context?.deploy?.id || Netlify.context?.deploy?.id || 'local')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 96);
  return { production: false, prefix: 'deploy/' + (deployId || 'local') + '/' };
}

function state() {
  const scope = runtimeScope();
  return {
    scope,
    heads: getStore(scope.production ? 'parable-project-heads' : 'parable-project-heads-sandbox', { consistency: 'strong' }),
    events: getStore(scope.production ? 'parable-project-events' : 'parable-project-events-sandbox', { consistency: 'strong' })
  };
}

const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);

function key(projectId: string) {
  const { scope } = state();
  return scope.prefix + 'project/' + projectId + '/head';
}

async function readHead(projectId: string) {
  const { heads } = state();
  return heads.getWithMetadata(key(projectId), { type: 'json' }) as Promise<{
    data: ProjectHead;
    etag: string;
    metadata: Record<string, unknown>;
  } | null>;
}

async function ensureHead(projectId: string) {
  const { heads } = state();
  let current = await readHead(projectId);
  if (current) return current;

  const now = new Date().toISOString();
  const initial: ProjectHead = {
    version: 'parable-project-head-v2',
    project_id: projectId,
    revision: 0,
    active_lease: null,
    last_mutation_id: null,
    last_mutation_type: null,
    state_refs: {},
    updated_at: now
  };

  await heads.setJSON(key(projectId), initial, { onlyIfNew: true } as any);
  current = await readHead(projectId);
  if (!current) throw new Error('PARABLE could not initialize the project revision head.');
  return current;
}

async function readBlobRevision(projectId: string) {
  const current = await ensureHead(projectId);
  return {
    project_id: projectId,
    revision: Number(current.data.revision || 0),
    active_lease: current.data.active_lease,
    state_refs: current.data.state_refs || {},
    updated_at: current.data.updated_at,
    backend: 'blobs' as const,
    degraded_read: false
  };
}

function parseConflictDetail(error: TransactionalStateError) {
  const body = error.detail as any;
  const raw = body?.details || body?.detail || '';
  if (typeof raw === 'object' && raw) return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch {}
  }
  return {};
}

async function readPostgresRevision(projectId: string) {
  const remote = await readTransactionalProjectState(projectId);

  if (!remote.exists) {
    // Lazy migration: the immutable Blob head remains the migration source only
    // until the transactional row exists. The first writer/read initializes it
    // once; PostgreSQL is authoritative after that point.
    const blob = await readBlobRevision(projectId);
    const bootstrapped = await bootstrapTransactionalProjectState({
      projectId,
      revision: blob.revision,
      stateRefs: blob.state_refs
    });
    return {
      project_id: projectId,
      revision: Number(bootstrapped.revision || 0),
      active_lease: null,
      state_refs: bootstrapped.state_refs || {},
      updated_at: new Date().toISOString(),
      backend: 'postgres' as const,
      degraded_read: false
    };
  }

  return {
    project_id: projectId,
    revision: Number(remote.revision || 0),
    active_lease: null,
    state_refs: remote.state_refs || {},
    updated_at: remote.updated_at || new Date().toISOString(),
    backend: 'postgres' as const,
    degraded_read: false
  };
}

export async function readProjectRevision(projectId: string) {
  if (!safeId(projectId)) throw new Error('Invalid project id.');

  if (transactionalStateMode() !== 'postgres') {
    return readBlobRevision(projectId);
  }

  try {
    return await readPostgresRevision(projectId);
  } catch (error) {
    const readFallback = String(Netlify.env.get('PARABLE_STATE_READ_FALLBACK') || '')
      .trim().toLowerCase() === 'blobs';

    if (readFallback) {
      const blob = await readBlobRevision(projectId);
      return { ...blob, degraded_read: true };
    }

    throw error;
  }
}

export async function acquireProjectMutation(args: {
  projectId: string;
  mutationType: string;
  expectedRevision?: number | null;
  ttlMs?: number;
}) {
  const projectId = args.projectId;
  if (!safeId(projectId)) throw new Error('Invalid project id.');

  if (transactionalStateMode() === 'postgres') {
    const current = await readPostgresRevision(projectId);
    const revision = Number(current.revision || 0);

    if (
      args.expectedRevision !== undefined &&
      args.expectedRevision !== null &&
      revision !== args.expectedRevision
    ) {
      throw new ProjectRevisionConflict(
        'The project changed while this operation was being prepared.',
        revision,
        args.expectedRevision
      );
    }

    const now = new Date();
    return {
      project_id: projectId,
      mutation_id: 'mut_' + crypto.randomUUID().replaceAll('-', ''),
      mutation_type: String(args.mutationType || 'mutation').slice(0, 80),
      base_revision: revision,
      expires_at: new Date(now.getTime() + Math.max(5000, Math.min(120000, Math.floor(args.ttlMs || 30000)))).toISOString(),
      backend: 'postgres' as const
    } satisfies ProjectMutationLease;
  }

  const { heads } = state();
  const mutationId = 'mut_' + crypto.randomUUID().replaceAll('-', '');
  const ttlMs = Math.max(5000, Math.min(120000, Math.floor(args.ttlMs || 30000)));

  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await ensureHead(projectId);
    const revision = Number(current.data.revision || 0);

    if (
      args.expectedRevision !== undefined &&
      args.expectedRevision !== null &&
      revision !== args.expectedRevision
    ) {
      throw new ProjectRevisionConflict(
        'The project changed while this operation was being prepared.',
        revision,
        args.expectedRevision
      );
    }

    const existingLease = current.data.active_lease;
    if (existingLease && Date.parse(existingLease.expires_at) > Date.now()) {
      const retryAfterMs = Math.max(250, Date.parse(existingLease.expires_at) - Date.now());
      throw new ProjectMutationBusy('Another project mutation is committing. Retry shortly.', retryAfterMs);
    }

    const now = new Date();
    const lease: LeaseState = {
      mutation_id: mutationId,
      mutation_type: String(args.mutationType || 'mutation').slice(0, 80),
      acquired_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlMs).toISOString()
    };

    const next: ProjectHead = {
      ...current.data,
      active_lease: lease,
      updated_at: now.toISOString()
    };

    const write = await heads.setJSON(key(projectId), next, { onlyIfMatch: current.etag } as any);
    if ((write as any)?.modified === false) continue;

    const claimed = await readHead(projectId);
    if (claimed?.data.active_lease?.mutation_id === mutationId) {
      return {
        project_id: projectId,
        mutation_id: mutationId,
        mutation_type: lease.mutation_type,
        base_revision: revision,
        expires_at: lease.expires_at,
        backend: 'blobs' as const
      } satisfies ProjectMutationLease;
    }
  }

  const latest = await ensureHead(projectId);
  throw new ProjectRevisionConflict(
    'PARABLE could not acquire the project mutation lease because the project changed repeatedly.',
    Number(latest.data.revision || 0),
    args.expectedRevision ?? null
  );
}

async function appendEvent(head: ProjectHead, metadata: Record<string, unknown>) {
  try {
    const { events, scope } = state();
    const eventId = 'evt_' + crypto.randomUUID().replaceAll('-', '');
    await events.setJSON(
      scope.prefix + 'project/' + head.project_id + '/events/' + String(head.revision).padStart(12, '0') + '-' + eventId,
      {
        id: eventId,
        project_id: head.project_id,
        revision: head.revision,
        mutation_id: head.last_mutation_id,
        mutation_type: head.last_mutation_type,
        metadata,
        committed_at: head.updated_at
      },
      { onlyIfNew: true } as any
    );
  } catch {
    // PostgreSQL/Blob revision safety must not depend on observability archival.
  }
}

async function mirrorPostgresHead(args: {
  projectId: string;
  revision: number;
  mutationId: string;
  mutationType: string;
  stateRefs: Record<string, string>;
  metadata: Record<string, unknown>;
}) {
  try {
    const next: ProjectHead = {
      version: 'parable-project-head-v2',
      project_id: args.projectId,
      revision: args.revision,
      active_lease: null,
      last_mutation_id: args.mutationId,
      last_mutation_type: args.mutationType,
      state_refs: args.stateRefs,
      updated_at: new Date().toISOString()
    };
    await state().heads.setJSON(key(args.projectId), next);
    await appendEvent(next, {
      ...args.metadata,
      authoritative_backend: 'postgres',
      mirror_only: true
    });
  } catch {
    // PostgreSQL remains authoritative. A failed archive mirror must never roll
    // back or falsify the already-committed database transaction.
  }
}

export async function commitProjectMutation(
  lease: ProjectMutationLease,
  metadata: Record<string, unknown> = {},
  statePatch: Record<string, string | null> = {}
) {
  if (lease.backend === 'postgres' || transactionalStateMode() === 'postgres') {
    try {
      const committed = await commitTransactionalProjectMutation({
        projectId: lease.project_id,
        expectedRevision: lease.base_revision,
        eventId: lease.mutation_id,
        mutationType: lease.mutation_type,
        actorUserId: typeof metadata.actor_id === 'string' ? metadata.actor_id : null,
        metadata,
        statePatch
      });

      const stateRefs = committed.state_refs || {};
      await mirrorPostgresHead({
        projectId: lease.project_id,
        revision: Number(committed.revision || lease.base_revision + 1),
        mutationId: lease.mutation_id,
        mutationType: lease.mutation_type,
        stateRefs,
        metadata
      });

      return {
        project_id: lease.project_id,
        previous_revision: lease.base_revision,
        revision: Number(committed.revision || lease.base_revision + 1),
        mutation_id: lease.mutation_id,
        mutation_type: lease.mutation_type,
        state_refs: stateRefs,
        backend: 'postgres' as const
      };
    } catch (error) {
      if (error instanceof TransactionalStateError && error.code === 'PROJECT_REVISION_CONFLICT') {
        const detail = parseConflictDetail(error);
        throw new ProjectRevisionConflict(
          'The project changed before this mutation could commit.',
          Number(detail.current_revision ?? lease.base_revision + 1),
          Number(detail.expected_revision ?? lease.base_revision)
        );
      }
      throw error;
    }
  }

  const { heads } = state();
  const current = await readHead(lease.project_id);
  if (!current) throw new Error('Project revision head disappeared.');

  if (current.data.active_lease?.mutation_id !== lease.mutation_id) {
    throw new ProjectRevisionConflict(
      'The project mutation lease is no longer owned by this operation.',
      Number(current.data.revision || 0),
      lease.base_revision
    );
  }

  const now = new Date().toISOString();
  const stateRefs = { ...(current.data.state_refs || {}) };
  for (const [name, ref] of Object.entries(statePatch)) {
    if (ref) stateRefs[name] = ref;
    else delete stateRefs[name];
  }

  const next: ProjectHead = {
    ...current.data,
    version: 'parable-project-head-v2',
    revision: Number(current.data.revision || 0) + 1,
    active_lease: null,
    last_mutation_id: lease.mutation_id,
    last_mutation_type: lease.mutation_type,
    state_refs: stateRefs,
    updated_at: now
  };

  const write = await heads.setJSON(key(lease.project_id), next, { onlyIfMatch: current.etag } as any);
  if ((write as any)?.modified === false) {
    const latest = await ensureHead(lease.project_id);
    throw new ProjectRevisionConflict(
      'The project changed before this mutation could commit.',
      Number(latest.data.revision || 0),
      lease.base_revision
    );
  }

  await appendEvent(next, metadata);
  return {
    project_id: lease.project_id,
    previous_revision: lease.base_revision,
    revision: next.revision,
    mutation_id: lease.mutation_id,
    mutation_type: lease.mutation_type,
    state_refs: next.state_refs,
    backend: 'blobs' as const
  };
}

export async function abortProjectMutation(lease: ProjectMutationLease) {
  if (lease.backend === 'postgres' || transactionalStateMode() === 'postgres') {
    // PostgreSQL uses compare-and-swap at commit time. There is no long-lived
    // database lease to release and therefore no stale lock to strand.
    return true;
  }

  const { heads } = state();
  const current = await readHead(lease.project_id);
  if (!current || current.data.active_lease?.mutation_id !== lease.mutation_id) return false;

  const next: ProjectHead = {
    ...current.data,
    active_lease: null,
    updated_at: new Date().toISOString()
  };
  const write = await heads.setJSON(key(lease.project_id), next, { onlyIfMatch: current.etag } as any);
  return (write as any)?.modified !== false;
}

export function projectMutationErrorResponse(error: unknown) {
  if (error instanceof ProjectMutationBusy) {
    return {
      status: 409,
      body: {
        error: error.message,
        code: error.code,
        retry_after_ms: error.retryAfterMs
      }
    };
  }

  if (error instanceof ProjectRevisionConflict) {
    return {
      status: 409,
      body: {
        error: error.message,
        code: error.code,
        current_revision: error.currentRevision,
        expected_revision: error.expectedRevision
      }
    };
  }

  if (error instanceof TransactionalStateError) {
    return {
      status: error.status,
      body: {
        error: error.message,
        code: error.code,
        retryable: error.retryable,
        state_backend: 'postgres'
      }
    };
  }

  return null;
}
