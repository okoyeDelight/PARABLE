import { getStore } from '@netlify/blobs';
import { getContext } from '@netlify/functions';

type LeaseState = {
  mutation_id: string;
  mutation_type: string;
  acquired_at: string;
  expires_at: string;
};

type ProjectHead = {
  version: 'parable-project-head-v1';
  project_id: string;
  revision: number;
  active_lease: LeaseState | null;
  last_mutation_id: string | null;
  last_mutation_type: string | null;
  updated_at: string;
};

export type ProjectMutationLease = {
  project_id: string;
  mutation_id: string;
  mutation_type: string;
  base_revision: number;
  expires_at: string;
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
    version: 'parable-project-head-v1',
    project_id: projectId,
    revision: 0,
    active_lease: null,
    last_mutation_id: null,
    last_mutation_type: null,
    updated_at: now
  };

  await heads.setJSON(key(projectId), initial, { onlyIfNew: true } as any);
  current = await readHead(projectId);
  if (!current) throw new Error('PARABLE could not initialize the project revision head.');
  return current;
}

export async function readProjectRevision(projectId: string) {
  if (!safeId(projectId)) throw new Error('Invalid project id.');
  const current = await ensureHead(projectId);
  return {
    project_id: projectId,
    revision: Number(current.data.revision || 0),
    active_lease: current.data.active_lease,
    updated_at: current.data.updated_at
  };
}

export async function acquireProjectMutation(args: {
  projectId: string;
  mutationType: string;
  expectedRevision?: number | null;
  ttlMs?: number;
}) {
  const { heads } = state();
  const projectId = args.projectId;
  if (!safeId(projectId)) throw new Error('Invalid project id.');

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
      const token: ProjectMutationLease = {
        project_id: projectId,
        mutation_id: mutationId,
        mutation_type: lease.mutation_type,
        base_revision: revision,
        expires_at: lease.expires_at
      };
      return token;
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
    // Revision safety must not depend on observability/event archival.
  }
}

export async function commitProjectMutation(
  lease: ProjectMutationLease,
  metadata: Record<string, unknown> = {}
) {
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
  const next: ProjectHead = {
    ...current.data,
    revision: Number(current.data.revision || 0) + 1,
    active_lease: null,
    last_mutation_id: lease.mutation_id,
    last_mutation_type: lease.mutation_type,
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
    mutation_type: lease.mutation_type
  };
}

export async function abortProjectMutation(lease: ProjectMutationLease) {
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

  return null;
}
