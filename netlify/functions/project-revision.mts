import { readProjectRevision } from './_lib/project-concurrency.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 96) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);

export default async (request: Request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const url = new URL(request.url);
  const projectId = clean(url.searchParams.get('projectId'));
  if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);

  const state = await readProjectRevision(projectId);
  return json({
    project_id: projectId,
    revision: state.revision,
    mutation_in_progress: Boolean(state.active_lease),
    retry_after_ms: state.active_lease
      ? Math.max(0, Date.parse(state.active_lease.expires_at) - Date.now())
      : 0,
    updated_at: state.updated_at
  });
};

export const config = {
  path: '/api/project-revision',
  rateLimit: {
    windowLimit: 6000,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
