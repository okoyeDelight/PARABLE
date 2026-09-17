import { getDeployStore, getStore } from '@netlify/blobs';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

function store() {
  const isProduction = Netlify.context?.deploy?.context === 'production';
  return isProduction
    ? getStore('parable-directions', { consistency: 'strong' })
    : getDeployStore('parable-directions');
}

const clean = (value: unknown) => String(value ?? '').trim();
const allowedLens = new Set([12, 14, 16, 18, 20, 24, 28, 32, 35, 40, 50, 65, 75, 85, 100, 135, 200]);

export default async (request: Request) => {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  const directions = store();

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = clean(url.searchParams.get('projectId'));
    const storyVersion = clean(url.searchParams.get('storyVersion'));
    if (!projectId || !storyVersion) return json({ error: 'projectId and storyVersion are required.' }, 400);

    const prefix = `project/${projectId}/${storyVersion}/`;
    const { blobs } = await directions.list({ prefix });
    const items = (await Promise.all(blobs.map(({ key }) => directions.get(key, { type: 'json' })))).filter(Boolean);
    return json({ project_id: projectId, story_version: storyVersion, directions: items });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const projectId = clean(body.projectId);
  const storyVersion = clean(body.storyVersion);
  const shotId = clean(body.shotId);
  const motion = clean(body.motion);
  const lighting = clean(body.lighting);
  const performance = clean(body.performance);
  const blocking = clean(body.blocking);
  const lens = Number(body.lens_mm);

  if (!projectId || !storyVersion || !shotId) {
    return json({ error: 'projectId, storyVersion and shotId are required.' }, 400);
  }
  if (!allowedLens.has(lens)) return json({ error: 'Unsupported lens value.' }, 400);
  if (motion.length > 120 || lighting.length > 160 || performance.length > 240 || blocking.length > 320) {
    return json({ error: 'Director control value is too long.' }, 400);
  }

  const value = {
    project_id: projectId,
    story_version: storyVersion,
    shot_id: shotId,
    lens_mm: lens,
    motion,
    lighting,
    performance,
    blocking,
    updated_at: new Date().toISOString()
  };

  await directions.setJSON(`project/${projectId}/${storyVersion}/${shotId}`, value);
  return json(value, 201);
};

export const config = { path: '/api/direction' };
