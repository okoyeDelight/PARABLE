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
  const { blobs } = await projectsStore.list({ prefix: 'project/' });
  if (blobs.length) return;
  await Promise.all(starterProjects.map((project) => projectsStore.setJSON(`project/${project.id}`, project)));
}

async function listProjects(projectsStore: ReturnType<typeof getStore>) {
  await seedIfNeeded(projectsStore);
  const { blobs } = await projectsStore.list({ prefix: 'project/' });
  const projects = (await Promise.all(
    blobs.map(({ key }) => projectsStore.get(key, { type: 'json' }))
  )).filter(Boolean) as typeof starterProjects;
  return projects.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

export default async (request: Request) => {
  const { projects, contexts } = getStores();

  if (request.method === 'GET') {
    return json(await listProjects(projects));
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const title = String(body.title || '').trim();
    if (!title) return json({ error: 'Story title is required.' }, 400);

    const sourceText = String(body.sourceText || '');
    const setting = String(body.setting || '').trim();
    const primaryAudience = String(body.primaryAudience || '').trim();
    const audienceScope = ['global', 'regional', 'local'].includes(String(body.audienceScope)) ? String(body.audienceScope) : 'global';
    const storyPeriod = ['present', 'historical', 'future'].includes(String(body.storyPeriod)) ? String(body.storyPeriod) : 'present';
    const id = `proj_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const now = new Date().toISOString();

    const project = {
      id,
      title,
      logline: sourceText.trim().slice(0, 180) || 'New story waiting for its first creative analysis.',
      source_text: sourceText || null,
      setting: setting || null,
      primary_audience: primaryAudience || null,
      audience_scope: audienceScope,
      story_period: storyPeriod,
      status: 'draft',
      progress: 5,
      created_at: now,
      updated_at: now
    };

    const projectContexts = [
      { context_type: 'audience', label: 'Primary audience', scope_value: primaryAudience || audienceScope, status: 'planned' },
      { context_type: 'time', label: 'Story period', scope_value: storyPeriod, status: 'planned' }
    ];
    if (setting) projectContexts.push({ context_type: 'location', label: 'Story setting', scope_value: setting, status: 'planned' });

    await Promise.all([
      projects.setJSON(`project/${id}`, project),
      contexts.setJSON(`project/${id}`, projectContexts)
    ]);

    return json(project, 201);
  }

  return json({ error: 'Method not allowed' }, 405);
};

export const config = { path: '/api/projects' };
