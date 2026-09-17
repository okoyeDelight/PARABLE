import { getDeployStore, getStore } from '@netlify/blobs';

type Shot = {
  id: string;
  beat: string;
  shot_size: string;
  lens_mm: number;
  motion: string;
  lighting: string;
  performance: string;
  purpose: string;
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

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

function splitSentences(text: string) {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function extractCharacters(text: string) {
  const stop = new Set([
    'The','A','An','He','She','They','It','I','We','You','Outside','Inside','Later','Then','When','After','Before','But','And','His','Her','Their','This','That','There','Here','God','Jesus','Lord'
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
    .slice(0, 5)
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

function screenplayBeats(sentences: string[], setting: string, characters: { name: string }[]) {
  const heading = `INT. ${setting ? setting.toUpperCase() : 'STORY LOCATION'} - ${inferTimeOfDay(sentences.join(' '))}`;
  const beats = sentences.slice(0, 6).map((sentence, index) => {
    const quote = sentence.match(/[“\"]([^”\"]+)[”\"]/);
    if (quote) {
      return {
        type: 'dialogue',
        speaker: characters[0]?.name || 'CHARACTER',
        text: quote[1],
        source_index: index
      };
    }
    return { type: 'action', text: sentence, source_index: index };
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
    purpose: t[5]
  }));
}

export default async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const sourceText = clean(body.sourceText);
  const title = clean(body.title) || 'Untitled story';
  const setting = clean(body.setting);
  const primaryAudience = clean(body.primaryAudience);
  const projectId = clean(body.projectId);

  if (sourceText.length < 20) {
    return json({ error: 'Give PARABLE at least a few sentences to understand.' }, 400);
  }

  const sentences = splitSentences(sourceText);
  const characters = extractCharacters(sourceText);
  const themes = extractThemes(sourceText);
  const conflict = inferConflict(sourceText, themes);
  const screenplay = screenplayBeats(sentences, setting, characters);
  const shots = shotPlan(sentences);
  const now = new Date().toISOString();

  const result = {
    id: `adapt_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
    project_id: projectId || null,
    title,
    engine: {
      name: 'PARABLE Story Intelligence',
      version: 'structured-v1',
      mode: 'deterministic-production',
      provider_ready: true
    },
    story_intelligence: {
      characters: characters.length ? characters : [{ name: 'Primary character', role: 'Primary character' }],
      themes,
      conflict,
      setting: setting || 'Not specified',
      primary_audience: primaryAudience || 'Not specified',
      emotional_turn: sentences[Math.min(2, Math.max(0, sentences.length - 1))] || sourceText.slice(0, 180),
      source_sentence_count: sentences.length
    },
    screenplay,
    shot_plan: shots,
    director_defaults: {
      lens_mm: shots[1]?.lens_mm || 50,
      motion: shots[1]?.motion || 'Slow push-in',
      lighting: shots[1]?.lighting || 'Soft motivated key',
      performance: shots[1]?.performance || 'Restrained'
    },
    created_at: now
  };

  const { adaptations, projects } = stores();
  const key = projectId ? `project/${projectId}/latest` : `adaptation/${result.id}`;
  await adaptations.setJSON(key, result);

  if (projectId) {
    const project = await projects.get(`project/${projectId}`, { type: 'json' }) as Record<string, unknown> | null;
    if (project) {
      await projects.setJSON(`project/${projectId}`, {
        ...project,
        status: 'shot_plan',
        progress: Math.max(Number(project.progress || 0), 35),
        updated_at: now
      });
    }
  }

  return json(result, 201);
};

export const config = { path: '/api/adapt' };
