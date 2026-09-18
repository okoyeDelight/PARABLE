import { getDeployStore, getStore } from '@netlify/blobs';
import { sha256 } from './_lib/story-ai.mts';
import { runStoryUnderstanding, type UnderstandInput } from './_lib/understand-ai.mts';
import {
  acquireProjectMutation,
  abortProjectMutation,
  commitProjectMutation,
  projectMutationErrorResponse,
  readProjectRevision,
  type ProjectMutationLease
} from './_lib/project-concurrency.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

function stores() {
  const production = Netlify.context?.deploy?.context === 'production';
  if (production) {
    return {
      understandings: getStore('parable-understandings', { consistency: 'strong' }),
      projects: getStore('parable-projects', { consistency: 'strong' })
    };
  }
  return {
    understandings: getDeployStore('parable-understandings'),
    projects: getDeployStore('parable-projects')
  };
}

const cleanMetadata = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const cleanManuscript = (value: unknown) => String(value ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/\t/g, '  ')
  .replace(/[ \t]+$/gm, '')
  .replace(/\n{4,}/g, '\n\n\n')
  .trim();
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);

function sentences(text: string) {
  return text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/).map((v) => v.trim()).filter(Boolean).slice(0, 14);
}

function sourceNames(text: string) {
  const stop = new Set(['The','A','An','He','She','They','It','I','We','You','Outside','Inside','Later','Then','When','After','Before','But','And','His','Her','Their','This','That','There','Here','God','Jesus','Lord','Morning','Evening','Night','Day']);
  const found = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/g) || [];
  return [...new Set(found.map((v) => v.trim()).filter((v) => !stop.has(v)))].slice(0, 6);
}

function fallbackUnderstanding(input: UnderstandInput) {
  const parts = sentences(input.sourceText);
  const names = sourceNames(input.sourceText);
  const primary = names[0] || 'Primary character';
  const lower = input.sourceText.toLowerCase();
  const themes = [
    /(pray|prayer|faith|god|lord|altar|calling)/.test(lower) ? 'Faith & calling' : '',
    /(fear|afraid|silence|quiet|wait)/.test(lower) ? 'Fear, waiting & uncertainty' : '',
    /(love|marry|ring|relationship)/.test(lower) ? 'Love & commitment' : '',
    /(choice|decision|letter|go|leave|stay)/.test(lower) ? 'Decision & consequence' : ''
  ].filter(Boolean);
  if (!themes.length) themes.push('Character desire', 'Decision & consequence');

  const evidence = parts[0] || input.sourceText.slice(0, 240);
  const conflict = /(pray|prayer)/.test(lower) && /(silence|quiet|wait)/.test(lower)
    ? 'Faith under the pressure of unanswered silence or waiting.'
    : 'The primary character faces a decision, desire or resistance that requires deeper model review.';

  return {
    story_bible: {
      premise: evidence,
      logline: input.sourceText.replace(/\s+/g, ' ').slice(0, 220),
      genre: 'Drama',
      tone: themes.join(', '),
      setting: input.setting || 'Not specified',
      story_period: 'Not established by deterministic fallback',
      target_audience: input.primaryAudience || 'Not specified',
      core_conflict: conflict,
      stakes: 'Requires model-backed understanding or human review.',
      emotional_turn: parts[Math.min(2, Math.max(0, parts.length - 1))] || evidence
    },
    characters: (names.length ? names : [primary]).map((name, index) => ({
      name,
      role: index === 0 ? 'Primary character' : 'Story character',
      desire: 'Requires model review',
      fear: 'Requires model review',
      wound: 'Requires model review',
      belief: 'Requires model review',
      arc: 'Requires model review',
      knowledge_state: 'Only information explicit in the manuscript is assumed.',
      source_basis: { basis: 'explicit', evidence: name === 'Primary character' ? evidence : name, confidence: name === 'Primary character' ? 0.5 : 0.9 }
    })),
    themes: themes.slice(0, 5).map((name) => ({
      name,
      meaning: 'Theme detected conservatively from manuscript language.',
      source_basis: { basis: 'inferred', evidence, confidence: 0.55 }
    })),
    spiritual_context: {
      christian_context: /(pray|prayer|faith|god|lord|jesus|church|chapel|calling)/.test(lower)
        ? 'Christian or spiritual language is present in the manuscript; interpretation requires review.'
        : 'No explicit Christian claim is added by the fallback.',
      scripture_mentions: [],
      theology_review_flags: []
    },
    scenes: [{
      id: 'scene_1',
      heading: input.setting || 'Story location not specified',
      objective: 'Requires model review',
      obstacle: conflict,
      turn: parts[Math.min(2, Math.max(0, parts.length - 1))] || evidence,
      reveal: '',
      emotional_state: themes[0] || 'Unresolved',
      source_basis: { basis: 'inferred', evidence, confidence: 0.5 }
    }],
    review: {
      confidence: 0.42,
      uncertainties: ['Deterministic Story Understanding fallback is active; deeper motivation, subtext and scene reasoning require a model or human review.'],
      fidelity_warnings: [],
      human_review_flags: ['Review the inferred conflict and emotional turn before screenplay adaptation.']
    }
  };
}

export default async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const input: UnderstandInput = {
    title: cleanMetadata(body.title).slice(0, 160) || 'Untitled story',
    sourceText: cleanManuscript(body.sourceText),
    setting: cleanMetadata(body.setting).slice(0, 240),
    primaryAudience: cleanMetadata(body.primaryAudience).slice(0, 240)
  };
  const projectId = cleanMetadata(body.projectId);

  if (projectId && !safeId(projectId)) return json({ error: 'Invalid project identifier.' }, 400);
  if (input.sourceText.length < 20) return json({ error: 'Give PARABLE at least a few sentences to understand.' }, 400);
  if (input.sourceText.length > 120000) return json({ error: 'This pass accepts up to 120,000 characters. Long-form orchestration is a later stage.' }, 413);

  const startingRevision = projectId ? await readProjectRevision(projectId) : null;

  const sourceHash = await sha256(`${input.title}\n${input.setting}\n${input.primaryAudience}\n${input.sourceText}`);
  const storyVersion = `story_${sourceHash.slice(0, 12)}`;
  const modelRun = await runStoryUnderstanding(input);
  const understanding = modelRun.data || fallbackUnderstanding(input);
  const now = new Date().toISOString();

  const result = {
    id: `understand_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
    project_id: projectId || null,
    title: input.title,
    story_version: storyVersion,
    source_hash: sourceHash,
    engine: {
      name: 'PARABLE Story Understanding',
      ...modelRun.engine,
      provider_ready: modelRun.engine.mode === 'model'
    },
    understanding,
    story_bible: understanding.story_bible,
    characters: understanding.characters,
    themes: understanding.themes,
    spiritual_context: understanding.spiritual_context,
    scenes: understanding.scenes,
    review: understanding.review,
    created_at: now
  };

  const { understandings, projects } = stores();
  const latestKey = projectId ? `project/${projectId}/latest` : `understanding/${result.id}`;
  const versionKey = projectId ? `project/${projectId}/versions/${storyVersion}` : `understanding/${result.id}/version/${storyVersion}`;
  let lease: ProjectMutationLease | null = null;

  if (projectId && startingRevision) {
    try {
      lease = await acquireProjectMutation({
        projectId,
        mutationType: 'story-understanding',
        expectedRevision: startingRevision.revision,
        ttlMs: 30000
      });
    } catch (error) {
      const handled = projectMutationErrorResponse(error);
      if (handled) {
        return json({
          ...handled.body,
          retryable: true,
          hint: 'PARABLE protected the newer project revision. The durable job can safely retry.'
        }, handled.status);
      }
      throw error;
    }
  }

  try {
    await Promise.all([
      understandings.setJSON(latestKey, result),
      understandings.setJSON(versionKey, result)
    ]);

    if (projectId) {
      const project = await projects.get(`project/${projectId}`, {
        type: 'json',
        consistency: 'strong'
      } as any) as Record<string, any> | null;

      if (project) {
        await projects.setJSON(`project/${projectId}`, {
          ...project,
          title: input.title,
          source_text: input.sourceText,
          source_hash: sourceHash,
          story_version: storyVersion,
          setting: input.setting || project.setting || null,
          primary_audience: input.primaryAudience || project.primary_audience || null,
          understanding_engine: {
            provider: modelRun.engine.provider,
            model: modelRun.engine.model,
            version: modelRun.engine.version,
            mode: modelRun.engine.mode,
            privacy_mode: modelRun.engine.privacy_mode
          },
          status: 'understood',
          progress: Math.max(Number(project.progress || 0), modelRun.engine.mode === 'model' ? 22 : 16),
          updated_at: now
        });
      }
    }

    if (lease) {
      const committed = await commitProjectMutation(lease, {
        story_version: storyVersion,
        source_hash: sourceHash,
        engine_mode: modelRun.engine.mode,
        provider: modelRun.engine.provider
      });
      (result as any).project_revision = committed.revision;
      (result as any).mutation_id = committed.mutation_id;
    }

    return json(result, 201);
  } catch (error) {
    if (lease) await abortProjectMutation(lease).catch(() => false);
    const handled = projectMutationErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }
};

export const config = {
  path: '/api/understand',
  rateLimit: {
    windowLimit: 16,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
