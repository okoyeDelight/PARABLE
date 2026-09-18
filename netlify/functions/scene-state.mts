import { getDeployStore, getStore } from '@netlify/blobs';
import {
  bootstrapContinuity,
  buildRenderContinuityContract,
  compactContinuityContext,
  evaluateAndApplyScene,
  type ContinuitySnapshot
} from './_lib/continuity-core.mts';
import { runContinuityExtraction } from './_lib/continuity-ai.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

function stores() {
  const production = Netlify.context?.deploy?.context === 'production';
  const make = (name: string) => production
    ? getStore(name, { consistency: 'strong' })
    : getDeployStore(name);

  return {
    continuity: make('parable-continuity'),
    sceneStates: make('parable-scene-states'),
    adaptations: make('parable-adaptations'),
    understandings: make('parable-understandings'),
    projects: make('parable-projects')
  };
}

const clean = (value: unknown, max = 120000) => String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const oneLine = (value: unknown, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);

async function latestProductionBible(projectId: string) {
  const s = stores();
  const [adaptation, understanding] = await Promise.all([
    s.adaptations.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<Record<string, any> | null>,
    s.understandings.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<Record<string, any> | null>
  ]);
  return adaptation?.production_bible || understanding?.understanding || understanding || null;
}

async function latestAdaptation(projectId: string) {
  return stores().adaptations.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<Record<string, any> | null>;
}

function screenplayText(adaptation: Record<string, any> | null) {
  const screenplay = adaptation?.screenplay || adaptation?.production_bible?.screenplay || null;
  if (!screenplay) return null;
  const heading = oneLine(screenplay.heading, 240);
  const beats = Array.isArray(screenplay.beats) ? screenplay.beats : [];
  const text = beats.map((beat: any) => {
    const speaker = oneLine(beat?.speaker, 120);
    const body = clean(beat?.text, 1800);
    if (!body) return '';
    return speaker ? speaker + ': ' + body : body;
  }).filter(Boolean).join('\n');
  return { heading, text };
}

async function loadOrBootstrap(projectId: string, storyVersion: string, bodyBible?: unknown) {
  const s = stores();
  const existing = await s.continuity.get('project/' + projectId + '/latest', { type: 'json' }) as ContinuitySnapshot | null;
  if (existing) return existing;

  const bible = bodyBible && typeof bodyBible === 'object'
    ? bodyBible as Record<string, any>
    : await latestProductionBible(projectId);
  if (!bible) return null;

  return bootstrapContinuity({
    projectId,
    storyVersion,
    productionBible: bible
  });
}

async function saveContinuity(snapshot: ContinuitySnapshot) {
  const s = stores();
  await Promise.all([
    s.continuity.setJSON('project/' + snapshot.project_id + '/latest', snapshot),
    s.continuity.setJSON('project/' + snapshot.project_id + '/versions/' + snapshot.story_version + '/latest', snapshot)
  ]);
}

export default async (request: Request) => {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = oneLine(url.searchParams.get('projectId'), 96);
    const storyVersion = oneLine(url.searchParams.get('storyVersion'), 96);
    const sceneId = oneLine(url.searchParams.get('sceneId'), 96);

    if (!projectId || !sceneId || !safeId(projectId) || !safeId(sceneId)) {
      return json({ error: 'A valid projectId and sceneId are required.' }, 400);
    }

    const key = storyVersion && safeId(storyVersion)
      ? 'project/' + projectId + '/' + storyVersion + '/' + sceneId
      : 'project/' + projectId + '/latest/' + sceneId;

    const value = await stores().sceneStates.get(key, { type: 'json' }) as Record<string, any> | null;
    if (!value) return json({ error: 'Scene continuity state was not found.' }, 404);
    return json(value);
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = oneLine(body.projectId, 96);
  if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);

  const s = stores();
  const project = await s.projects.get('project/' + projectId, { type: 'json' }) as Record<string, any> | null;
  const adaptation = await latestAdaptation(projectId);

  const storyVersion = oneLine(
    body.storyVersion || project?.story_version || adaptation?.story_version || 'story_unknown',
    96
  );
  if (!safeId(storyVersion)) return json({ error: 'Invalid storyVersion.' }, 400);

  const suppliedScene = body.scene && typeof body.scene === 'object' ? body.scene : {};
  const adapted = screenplayText(adaptation);

  const sceneIndex = Math.max(1, Math.floor(Number(suppliedScene.index || body.sceneIndex || 1) || 1));
  const sceneId = oneLine(suppliedScene.id || body.sceneId || ('scene_' + sceneIndex), 96);
  if (!safeId(sceneId)) return json({ error: 'Invalid sceneId.' }, 400);

  const heading = oneLine(suppliedScene.heading || body.heading || adapted?.heading || '', 240);
  const sceneText = clean(suppliedScene.text || body.sceneText || adapted?.text || '', 120000);
  if (sceneText.length < 10) {
    return json({
      error: 'No usable scene text was supplied and PARABLE could not derive one from the latest adaptation.'
    }, 400);
  }

  const continuity = await loadOrBootstrap(projectId, storyVersion, body.productionBible);
  if (!continuity) {
    return json({
      error: 'PARABLE could not bootstrap continuity. Run Story Understanding / Adaptation first or supply productionBible.'
    }, 409);
  }

  const extraction = await runContinuityExtraction({
    projectId,
    storyVersion,
    sceneId,
    sceneIndex,
    heading,
    sceneText,
    continuity
  });

  const mode = oneLine(body.mode || 'apply', 20).toLowerCase();
  if (!['apply', 'check'].includes(mode)) return json({ error: 'mode must be apply or check.' }, 400);

  const evaluated = evaluateAndApplyScene(continuity, extraction.scene, { apply: mode === 'apply' });
  const snapshot = evaluated.snapshot;
  const renderContract = buildRenderContinuityContract(snapshot, sceneId);

  const result = {
    id: 'scene_state_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    project_id: projectId,
    story_version: storyVersion,
    scene_id: sceneId,
    scene_index: sceneIndex,
    heading,
    source: body.sceneText || suppliedScene.text ? 'submitted-scene' : 'latest-adaptation',
    mode,
    extractor: extraction.engine,
    extracted_scene_state: extraction.scene,
    render_notes: extraction.render_notes,
    uncertainties: extraction.uncertainties,
    warnings: evaluated.warnings,
    can_render: evaluated.can_render,
    requires_human_review: extraction.engine.mode !== 'model' || extraction.uncertainties.length > 0,
    continuity_context: compactContinuityContext(snapshot),
    render_contract: renderContract,
    created_at: new Date().toISOString()
  };

  if (mode === 'apply') {
    await Promise.all([
      saveContinuity(snapshot),
      s.sceneStates.setJSON('project/' + projectId + '/' + storyVersion + '/' + sceneId, result),
      s.sceneStates.setJSON('project/' + projectId + '/latest/' + sceneId, result)
    ]);

    if (project) {
      await s.projects.setJSON('project/' + projectId, {
        ...project,
        continuity_version: snapshot.schema_version,
        continuity_scene_cursor: snapshot.scene_cursor,
        continuity_last_scene_id: snapshot.last_scene_id,
        continuity_warning_count: snapshot.warnings.length,
        status: evaluated.can_render ? 'continuity_ready' : 'continuity_review',
        progress: Math.max(Number(project.progress || 0), evaluated.can_render ? 54 : 50),
        updated_at: new Date().toISOString()
      });
    }
  }

  return json(result, mode === 'apply' ? 201 : 200);
};

export const config = {
  path: '/api/scene-state',
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
