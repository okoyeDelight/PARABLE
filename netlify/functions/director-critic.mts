import { getDeployStore, getStore } from '@netlify/blobs';
import { compactCriticPayload, runFilmCritic } from './_lib/critic-ai.mts';
import { readAuthoritativeProjectState } from './_lib/project-artifacts.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const clean = (value: unknown, max = 5000) => String(value ?? '').trim().slice(0, max);

function stores() {
  const production = Netlify.context?.deploy?.context === 'production';
  if (production) {
    return {
      adaptations: getStore('parable-adaptations', { consistency: 'strong' }),
      projects: getStore('parable-projects', { consistency: 'strong' }),
      reviews: getStore('parable-film-reviews', { consistency: 'strong' })
    };
  }
  return {
    adaptations: getDeployStore('parable-adaptations'),
    projects: getDeployStore('parable-projects'),
    reviews: getDeployStore('parable-film-reviews')
  };
}

export default async (request: Request) => {
  const url = new URL(request.url);
  const { adaptations, projects, reviews } = stores();

  if (request.method === 'GET') {
    const projectId = clean(url.searchParams.get('projectId'), 96);
    const storyVersion = clean(url.searchParams.get('storyVersion'), 96);
    if (!safeId(projectId) || !safeId(storyVersion)) return json({ error: 'A valid project and story version are required.' }, 400);
    const review = await reviews.get(`project/${projectId}/versions/${storyVersion}/latest`, { type: 'json' }) as any;
    return review ? json(review) : json({ error: 'No review exists for that story version yet.' }, 404);
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const projectId = clean(body.projectId, 96);
  const storyVersion = clean(body.storyVersion, 96);
  if (!safeId(projectId) || !safeId(storyVersion)) return json({ error: 'A valid project and story version are required.' }, 400);

  const authoritativeAdaptation = await readAuthoritativeProjectState<any>(projectId, 'adaptation:latest');
  const authoritativeProject = await readAuthoritativeProjectState<any>(projectId, 'project:metadata');
  const [cachedAdaptation, cachedProject] = await Promise.all([
    adaptations.get(`project/${projectId}/versions/${storyVersion}`, { type: 'json' }) as Promise<any>,
    projects.get(`project/${projectId}`, { type: 'json' }) as Promise<any>
  ]);
  const adaptation = authoritativeAdaptation?.value?.story_version === storyVersion
    ? authoritativeAdaptation.value
    : cachedAdaptation;
  const project = authoritativeProject?.value || cachedProject;
  if (!adaptation) return json({ error: 'That story version could not be found.' }, 404);
  if (!project) return json({ error: 'That project could not be found.' }, 404);

  const packageData = compactCriticPayload(project, adaptation);
  const modelRun = await runFilmCritic(packageData, adaptation, { lane: 'protected' });
  const result = {
    id: `review_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
    project_id: projectId,
    story_version: storyVersion,
    engine: modelRun.engine,
    review: modelRun.data,
    created_at: new Date().toISOString(),
    suggestions_are_advisory: true
  };

  await Promise.all([
    reviews.setJSON(`project/${projectId}/versions/${storyVersion}/latest`, result),
    reviews.setJSON(`project/${projectId}/versions/${storyVersion}/${result.id}`, result)
  ]);
  return json(result, 201);
};

export const config = {
  path: '/api/director-critic',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
