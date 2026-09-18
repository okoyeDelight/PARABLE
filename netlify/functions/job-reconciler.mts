import type { Config } from '@netlify/functions';
import { recoverStalledJobs } from './_lib/job-recovery.mts';

export default async () => {
  const result = await recoverStalledJobs({
    limit: 25,
    minAgeMs: 30000
  });

  console.log('PARABLE durable job reconciler', JSON.stringify({
    enabled: result.enabled,
    claimed: result.claimed,
    recovered: result.recovered,
    dispatched: result.dispatched,
    failed: result.failed,
    reason: result.reason || null
  }));
};

export const config: Config = {
  schedule: '* * * * *'
};
