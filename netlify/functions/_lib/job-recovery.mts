import { dispatchDurableJob } from './job-dispatcher.mts';
import { markJobQueued, type JobKind } from './job-store.mts';
import {
  claimRecoverableTransactionalJobs,
  transactionalStateMode
} from './transactional-state.mts';

const clean = (value: unknown, max = 600) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const supported = new Set<JobKind>([
  'scene-state',
  'shot-state',
  'story-understanding',
  'adaptation',
  'film-critic',
  'keyframe-generate',
  'reference-profile',
  'scale-noop'
]);

export async function recoverStalledJobs(args: {
  limit?: number;
  minAgeMs?: number;
} = {}) {
  if (transactionalStateMode() !== 'postgres') {
    return {
      enabled: false,
      claimed: false,
      recovered: 0,
      dispatched: 0,
      failed: 0,
      reason: 'postgres-not-authoritative',
      jobs: []
    };
  }

  const recoveryToken = 'recovery_' + crypto.randomUUID().replaceAll('-', '');
  const batch = await claimRecoverableTransactionalJobs({
    recoveryToken,
    limit: args.limit ?? 25,
    minAgeMs: args.minAgeMs ?? 30000
  });

  if (!batch.claimed) {
    return {
      enabled: true,
      claimed: false,
      recovered: 0,
      dispatched: 0,
      failed: 0,
      reason: batch.reason || 'recovery-busy',
      jobs: []
    };
  }

  const outcomes: Array<Record<string, unknown>> = [];
  let dispatched = 0;
  let failed = 0;

  for (const row of batch.jobs || []) {
    const kind = clean(row.kind, 80) as JobKind;
    const id = clean(row.id, 180);

    if (!id || !supported.has(kind)) {
      failed += 1;
      outcomes.push({
        id,
        kind,
        ok: false,
        error: 'unsupported-recovery-job'
      });
      continue;
    }

    try {
      const result = await dispatchDurableJob(id, kind);
      await markJobQueued(id, result.event_id);
      dispatched += 1;
      outcomes.push({
        id,
        kind,
        ok: true,
        backend: result.backend,
        degraded_from_primary: Boolean(result.primary_error)
      });
    } catch (error) {
      failed += 1;
      outcomes.push({
        id,
        kind,
        ok: false,
        error: clean(error instanceof Error ? error.message : error, 600)
      });
    }
  }

  return {
    enabled: true,
    claimed: true,
    scope: batch.scope || null,
    recovered: (batch.jobs || []).length,
    dispatched,
    failed,
    jobs: outcomes
  };
}
