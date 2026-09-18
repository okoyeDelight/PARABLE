import { getDeployStore, getStore } from '@netlify/blobs';

const starterProjects = [
  {
    id: 'proj_the_altar',
    title: 'The Altar',
    logline: 'A young believer discovers that the battle for his future began long before he understood the cost of surrender.',
    source_text: null,
    setting: 'Nigeria',
    primary_audience: 'Global Christian young adults',
    audience_scope: 'global',
    story_period: 'present',
    status: 'story_bible',
    progress: 38,
    created_at: '2026-09-16T08:00:00.000Z',
    updated_at: '2026-09-16T18:00:00.000Z'
  },
  {
    id: 'proj_before_i_said_yes',
    title: 'Before I Said Yes',
    logline: 'Love, calling and conviction collide when two people discover that saying yes to each other may demand a deeper yes first.',
    source_text: null,
    setting: 'Accra, Ghana',
    primary_audience: 'Christian young adults',
    audience_scope: 'regional',
    story_period: 'present',
    status: 'episode_plan',
    progress: 24,
    created_at: '2026-09-16T08:05:00.000Z',
    updated_at: '2026-09-16T17:30:00.000Z'
  },
  {
    id: 'proj_the_watchman',
    title: 'The Watchman',
    logline: 'A quiet campus night becomes a spiritual turning point when one student notices what everyone else has learned to ignore.',
    source_text: null,
    setting: 'University campus',
    primary_audience: 'Christian students',
    audience_scope: 'local',
    story_period: 'present',
    status: 'draft',
    progress: 12,
    created_at: '2026-09-16T08:10:00.000Z',
    updated_at: '2026-09-16T17:00:00.000Z'
  }
];

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);

function getStores() {
  const isProduction = Netlify.context?.deploy?.context === 'production';
  if (isProduction) {
    return {
      projects: getStore('parable-projects', { consistency: 'strong' }),
      contexts: getStore('parable-contexts', { consistency: 'strong' })
    };
  }
  return {
    projects: getDeployStore('parable-projects'),
    contexts: getDeployStore('parable-contexts')
  };
}

async function seedIfNeeded(projectsStore: ReturnType<typeof getStore>) {
  const seeded = await projectsStore.get('system/seed-v1', { type: 'json' }) as { ready?: boolean } | null;
  if (seeded?.ready) return;
  await Promise.all([
    ...starterProjects.map((project) => projectsStore.setJSON(`project/${project.id}`, project)),
    projectsStore.setJSON('system/seed-v1', { ready: true, seeded_at: new Date().toISOString() })
  ]);
}

async function listProjects(projectsStore: ReturnType<typeof getStore>, limit = 50) {
  await seedIfNeeded(projectsStore);
  const keys: string[] = [];
  const pages = projectsStore.list({ prefix: 'project/', paginate: true });
  for await (const page of pages as AsyncIterable<{ blobs: { key: string }[] }>) {
    for (const blob of page.blobs) {
      keys.push(blob.key);
      if (keys.length >= limit) break;
    }
    if (keys.length >= limit) break;
  }
  const projects = (await Promise.all(
    keys.map((key) => projectsStore.get(key, { type: 'json' }))
  )).filter(Boolean) as typeof starterProjects;
  return projects.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

export default async (request: Request) => {
  const { projects, contexts } = getStores();

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = String(url.searchParams.get('id') || '').trim();

    if (projectId) {
      if (!safeId(projectId)) return json({ error: 'Invalid project identifier.' }, 400);
      const stored = await projects.get(`project/${projectId}`, { type: 'json' });
      if (stored) return json(stored);
      const starter = starterProjects.find((project) => project.id === projectId);
      return starter ? json(starter) : json({ error: 'Project not found.' }, 404);
    }

    const requestedLimit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 50) || 50));
    return json(await listProjects(projects, requestedLimit));
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const title = String(body.title || '').trim();
    if (!title) return json({ error: 'Story title is required.' }, 400);

    const sourceText = String(body.sourceText || '');
    if (sourceText.length > 120000) return json({ error: 'Story input is too large for this project creation pass.' }, 413);

    const setting = String(body.setting || '').trim();
    const primaryAudience = String(body.primaryAudience || '').trim();
    const audienceScope = ['global', 'regional', 'local'].includes(String(body.audienceScope)) ? String(body.audienceScope) : 'global';
    const storyPeriod = ['present', 'historical', 'future'].includes(String(body.storyPeriod)) ? String(body.storyPeriod) : 'present';
    const id = `proj_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const now = new Date().toISOString();

    const project = {
      id,
      title: title.slice(0, 160),
      logline: sourceText.trim().slice(0, 180) || 'New story waiting for its first creative analysis.',
      source_text: sourceText || null,
      setting: setting.slice(0, 240) || null,
      primary_audience: primaryAudience.slice(0, 240) || null,
      audience_scope: audienceScope,
      story_period: storyPeriod,
      status: 'draft',
      progress: 5,
      created_at: now,
      updated_at: now
    };

    const projectContexts = [
      { context_type: 'audience', label: 'Primary audience', scope_value: primaryAudience.slice(0, 240) || audienceScope, status: 'planned' },
      { context_type: 'time', label: 'Story period', scope_value: storyPeriod, status: 'planned' }
    ];
    if (setting) projectContexts.push({ context_type: 'location', label: 'Story setting', scope_value: setting.slice(0, 240), status: 'planned' });

    await Promise.all([
      projects.setJSON(`project/${id}`, project),
      contexts.setJSON(`project/${id}`, projectContexts)
    ]);

    return json(project, 201);
  }

  return json({ error: 'Method not allowed' }, 405);
};

export const config = {
  path: '/api/projects',
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
