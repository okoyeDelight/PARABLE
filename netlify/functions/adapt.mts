import { getDeployStore, getStore } from '@netlify/blobs';
import { runStoryModel, sha256, type StoryInput } from './_lib/story-ai.mts';

type Shot = {
  id: string;
  beat: string;
  shot_size: string;
  lens_mm: number;
  motion: string;
  lighting: string;
  performance: string;
  purpose: string;
  blocking?: string;
  continuity_notes?: string;
  source_basis?: Record<string, unknown>;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

function stores() {
  const isProduction = Netlify.context?.deploy?.context === 'production';
  if (isProduction) {
    return {
      adaptations: getStore('parable-adaptations', { consistency: 'strong' }),
      projects: getStore('parable-projects', { consistency: 'strong' })
    };
  }
  return {
    adaptations: getDeployStore('parable-adaptations'),
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

function splitSentences(text: string) {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 18);
}

function extractCharacters(text: string) {
  const stop = new Set([
    'The','A','An','He','She','They','It','I','We','You','Outside','Inside','Later','Then','When','After','Before','But','And','His','Her','Their','This','That','There','Here','God','Jesus','Lord','Morning','Evening','Night','Day'
  ]);
  const counts = new Map<string, number>();
  const matches = text.match(/\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b/g) || [];
  for (const raw of matches) {
    const name = raw.trim();
    if (stop.has(name)) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name], index) => ({ name, role: index === 0 ? 'Primary character' : 'Story character' }));
}

const themeLexicon: Record<string, string[]> = {
  'Faith & surrender': ['pray','prayed','prayer','faith','altar','surrender','god','lord','believe'],
  'Calling & purpose': ['calling','called','purpose','future','assignment','destiny'],
  'Fear & courage': ['fear','afraid','scared','courage','brave','hesitated'],
  'Waiting & silence': ['wait','waiting','silence','quiet','still','answer'],
  'Love & commitment': ['love','marry','marriage','yes','relationship','heart'],
  'Identity & belonging': ['identity','belong','home','family','name','who'],
  'Conflict & decision': ['choice','choose','decision','decide','versus','but','however']
};

function extractThemes(text: string) {
  const lower = text.toLowerCase();
  const scored = Object.entries(themeLexicon).map(([theme, words]) => ({
    theme,
    score: words.reduce((n, word) => n + (lower.includes(word) ? 1 : 0), 0)
  })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const result = scored.slice(0, 4).map((x) => x.theme);
  if (!result.length) result.push('Character desire', 'Decision & consequence');
  return result;
}

function inferConflict(text: string, themes: string[]) {
  const lower = text.toLowerCase();
  if ((lower.includes('calling') || lower.includes('purpose')) && lower.includes('fear')) return 'Calling versus fear';
  if ((lower.includes('pray') || lower.includes('prayer')) && (lower.includes('silence') || lower.includes('quiet'))) return 'Faith versus unanswered silence';
  if (lower.includes('love') && (lower.includes('calling') || lower.includes('purpose'))) return 'Love versus calling';
  return themes.length > 1 ? `${themes[0]} under pressure from ${themes[1].toLowerCase()}` : 'A desire meets resistance';
}

function inferTimeOfDay(text: string) {
  const lower = text.toLowerCase();
  if (/(night|midnight|dark)/.test(lower)) return 'NIGHT';
  if (/(evening|dusk|sunset)/.test(lower)) return 'EVENING';
  if (/(morning|dawn|sunrise)/.test(lower)) return 'MORNING';
  return 'DAY';
}

function basis(evidence: string, kind: 'explicit' | 'inferred' | 'creative-adaptation' = 'explicit', confidence = .8) {
  return { basis: kind, evidence, confidence };
}

function screenplayBeats(sentences: string[], setting: string, characters: { name: string }[]) {
  const heading = `INT. ${setting ? setting.toUpperCase() : 'STORY LOCATION'} - ${inferTimeOfDay(sentences.join(' '))}`;
  const beats = sentences.slice(0, 8).map((sentence, index) => {
    const quote = sentence.match(/[“\"]([^”\"]+)[”\"]/);
    if (quote) {
      return {
        type: 'dialogue',
        speaker: characters[0]?.name || 'CHARACTER',
        text: quote[1],
        source_index: index,
        source_basis: basis(sentence)
      };
    }
    return { type: 'action', speaker: '', text: sentence, source_index: index, source_basis: basis(sentence) };
  });
  return { heading, beats };
}

function shotPlan(sentences: string[]): Shot[] {
  const source = sentences.length ? sentences : ['A character enters the scene.'];
  const templates = [
    ['Establishing wide', 35, 'Slow drift', 'Natural environment', 'Let the environment breathe', 'Orient the viewer inside the story world'],
    ['Medium close', 50, 'Slow push-in', 'Soft motivated key', 'Keep the face restrained', 'Move from world into character intention'],
    ['Reaction close-up', 85, 'Locked', 'Window / practical edge', 'Hold one beat longer than comfortable', 'Let the internal turn land before explanation'],
    ['Over-shoulder', 50, 'Measured handheld', 'Low-contrast practicals', 'Listen before responding', 'Preserve relationship and tension'],
    ['Closing wide', 24, 'Gentle pull-back', 'Shape silhouette and negative space', 'Do less; leave the question open', 'End on consequence rather than exposition']
  ] as const;

  return templates.map((t, index) => ({
    id: `shot_${index + 1}`,
    beat: source[index % source.length],
    shot_size: t[0],
    lens_mm: t[1],
    motion: t[2],
    lighting: t[3],
    performance: t[4],
    purpose: t[5],
    blocking: 'Preserve the physical relationship established by the previous shot.',
    continuity_notes: 'Check eyeline, screen direction, props and emotional intensity before rendering.',
    source_basis: basis(source[index % source.length], index < source.length ? 'explicit' : 'creative-adaptation', index < source.length ? .82 : .62)
  }));
}

function deterministicResult(input: StoryInput, sourceHash: string) {
  const sentences = splitSentences(input.sourceText);
  const characters = extractCharacters(input.sourceText);
  const themes = extractThemes(input.sourceText);
  const conflict = inferConflict(input.sourceText, themes);
  const screenplay = screenplayBeats(sentences, input.setting, characters);
  const shots = shotPlan(sentences);
  const safeCharacters = characters.length ? characters : [{ name: 'Primary character', role: 'Primary character' }];
  const detailedCharacters = safeCharacters.map((character) => ({
    ...character,
    desire: 'Requires model review',
    fear: 'Requires model review',
    wound: 'Requires model review',
    belief: 'Requires model review',
    arc: 'Requires model review',
    knowledge_state: 'Only facts explicit in the submitted manuscript are assumed.',
    source_basis: basis(character.name, 'explicit', .72)
  }));
  const detailedThemes = themes.map((name) => ({ name, meaning: 'Theme detected from manuscript language.', source_basis: basis(name, 'inferred', .65) }));
  const continuityLedger = safeCharacters.map((character) => ({ entity: character.name, fact: `${character.name} appears in the submitted manuscript.`, source_basis: basis(character.name, 'explicit', .9) }));
  const review = {
    confidence: .48,
    uncertainties: ['Deterministic fallback is active; deeper character and scene reasoning requires an external model provider.'],
    fidelity_warnings: [],
    human_review_flags: ['Review screenplay adaptation before render.']
  };
  const storyBible = {
    premise: sentences[0] || input.sourceText.slice(0, 180),
    logline: input.sourceText.replace(/\s+/g, ' ').slice(0, 180),
    genre: 'Drama',
    tone: themes.join(', '),
    setting: input.setting || 'Not specified',
    story_period: 'present',
    target_audience: input.primaryAudience || 'Not specified',
    core_conflict: conflict,
    stakes: 'Requires model review for deeper stakes analysis.',
    emotional_turn: sentences[Math.min(2, Math.max(0, sentences.length - 1))] || input.sourceText.slice(0, 180)
  };
  const productionBible = {
    story_bible: storyBible,
    characters: detailedCharacters,
    themes: detailedThemes,
    spiritual_context: { christian_context: 'Detected conservatively from manuscript language.', scripture_mentions: [], theology_review_flags: [] },
    scenes: [{ id: 'scene_1', heading: screenplay.heading, objective: 'Requires model review', obstacle: conflict, turn: sentences[2] || sentences[0] || '', reveal: '', emotional_state: themes[0] || 'Unresolved', source_basis: basis(sentences[0] || '', 'inferred', .6) }],
    screenplay,
    shot_plan: shots,
    continuity_ledger: continuityLedger,
    review
  };

  return {
    production_bible: productionBible,
    source_hash: sourceHash,
    story_intelligence: {
      characters: safeCharacters.map((c) => ({ ...c, desire: '', fear: '', arc: '' })),
      themes,
      conflict,
      setting: storyBible.setting,
      primary_audience: storyBible.target_audience,
      emotional_turn: storyBible.emotional_turn,
      source_sentence_count: sentences.length
    },
    screenplay,
    shot_plan: shots,
    continuity_ledger: continuityLedger,
    review
  };
}

function normalizeModelOutput(modelData: Record<string, any>, input: StoryInput, sourceHash: string) {
  const bible = modelData.story_bible || {};
  const characters = Array.isArray(modelData.characters) ? modelData.characters : [];
  const themes = Array.isArray(modelData.themes) ? modelData.themes : [];
  const screenplay = modelData.screenplay || { heading: '', beats: [] };
  const shots = Array.isArray(modelData.shot_plan) ? modelData.shot_plan : [];

  return {
    production_bible: modelData,
    source_hash: sourceHash,
    story_intelligence: {
      characters: characters.map((c: any) => ({ name: c.name || 'Unnamed character', role: c.role || 'Story character', desire: c.desire || '', fear: c.fear || '', arc: c.arc || '' })),
      themes: themes.map((t: any) => t.name || String(t)).filter(Boolean),
      conflict: bible.core_conflict || 'Unresolved conflict',
      setting: bible.setting || input.setting || 'Not specified',
      primary_audience: bible.target_audience || input.primaryAudience || 'Not specified',
      emotional_turn: bible.emotional_turn || '',
      source_sentence_count: splitSentences(input.sourceText).length
    },
    screenplay,
    shot_plan: shots,
    continuity_ledger: modelData.continuity_ledger || [],
    review: modelData.review || { confidence: 0, uncertainties: [], fidelity_warnings: [], human_review_flags: [] }
  };
}

export default async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const input: StoryInput = {
    sourceText: cleanManuscript(body.sourceText),
    title: cleanMetadata(body.title).slice(0, 160) || 'Untitled story',
    setting: cleanMetadata(body.setting).slice(0, 240),
    primaryAudience: cleanMetadata(body.primaryAudience).slice(0, 240)
  };
  const projectId = cleanMetadata(body.projectId);

  if (projectId && !safeId(projectId)) return json({ error: 'Invalid project identifier.' }, 400);
  if (input.sourceText.length < 20) return json({ error: 'Give PARABLE at least a few sentences to understand.' }, 400);
  if (input.sourceText.length > 120000) {
    return json({ error: 'This pass accepts up to 120,000 characters. Long-form chapter orchestration is a separate production stage.' }, 413);
  }

  const sourceHash = await sha256(`${input.title}\n${input.setting}\n${input.primaryAudience}\n${input.sourceText}`);
  const storyVersion = `story_${sourceHash.slice(0, 12)}`;
  const modelRun = await runStoryModel(input);
  const normalized = modelRun.data
    ? normalizeModelOutput(modelRun.data, input, sourceHash)
    : deterministicResult(input, sourceHash);
  const now = new Date().toISOString();
  const shots = normalized.shot_plan as Shot[];

  const result = {
    id: `adapt_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
    project_id: projectId || null,
    title: input.title,
    story_version: storyVersion,
    source_hash: sourceHash,
    engine: {
      name: 'PARABLE Story Intelligence',
      version: modelRun.engine.version,
      mode: modelRun.engine.mode,
      provider: modelRun.engine.provider,
      model: modelRun.engine.model,
      privacy_mode: modelRun.engine.privacy_mode || null,
      provider_ready: modelRun.engine.mode === 'model',
      fallback_reason: modelRun.engine.fallback_reason || null
    },
    ...normalized,
    director_defaults: {
      lens_mm: shots[1]?.lens_mm || shots[0]?.lens_mm || 50,
      motion: shots[1]?.motion || shots[0]?.motion || 'Slow push-in',
      lighting: shots[1]?.lighting || shots[0]?.lighting || 'Soft motivated key',
      performance: shots[1]?.performance || shots[0]?.performance || 'Restrained'
    },
    created_at: now
  };

  const { adaptations, projects } = stores();
  const latestKey = projectId ? `project/${projectId}/latest` : `adaptation/${result.id}`;
  const versionKey = projectId ? `project/${projectId}/versions/${storyVersion}` : `adaptation/${result.id}/version/${storyVersion}`;
  await Promise.all([
    adaptations.setJSON(latestKey, result),
    adaptations.setJSON(versionKey, result)
  ]);

  if (projectId) {
    const project = await projects.get(`project/${projectId}`, { type: 'json' }) as Record<string, unknown> | null;
    if (project) {
      await projects.setJSON(`project/${projectId}`, {
        ...project,
        title: input.title,
        source_text: input.sourceText,
        source_hash: sourceHash,
        story_version: storyVersion,
        setting: input.setting || project.setting || null,
        primary_audience: input.primaryAudience || project.primary_audience || null,
        story_engine: {
          provider: modelRun.engine.provider,
          model: modelRun.engine.model,
          version: modelRun.engine.version,
          mode: modelRun.engine.mode,
          privacy_mode: modelRun.engine.privacy_mode || null
        },
        status: 'shot_plan',
        progress: Math.max(Number(project.progress || 0), modelRun.engine.mode === 'model' ? 42 : 35),
        updated_at: now
      });
    }
  }

  return json(result, 201);
};

export const config = {
  path: '/api/adapt',
  rateLimit: {
    windowLimit: 12,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
