import { buildKeyframeGenerationPlan } from './_lib/keyframe-generation-core.mts';
import {
  listShotKeyframeGenerations,
  readKeyframeGeneration,
  saveKeyframeAsset,
  saveKeyframeGeneration
} from './_lib/keyframe-assets.mts';
import { readKeyframePlan, readRenderSpec } from './_lib/render-store.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 1600) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,180}$/.test(value);
const money = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000) / 1_000_000 : null;
};

function classifyStatus(status: number) {
  if (status === 402) return 'credits-or-budget';
  if (status === 429) return 'rate-limit';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'upstream-5xx';
  return 'provider-rejected';
}

function assetUrl(request: Request, hash: string) {
  const url = new URL('/api/keyframe-asset', request.url);
  url.searchParams.set('id', hash);
  return url.toString();
}

export default async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const jobId = clean(request.headers.get('x-parable-job-id'), 180);
  const workload = clean(request.headers.get('x-parable-workload'), 80);
  if (!jobId || !safeId(jobId) || workload !== 'durable-pipeline') {
    return json({
      error: 'Billable first-frame generation must run through PARABLE durable jobs.',
      code: 'DURABLE_JOB_REQUIRED',
      next_action: 'POST /api/jobs with kind=keyframe-generate and an Idempotency-Key.'
    }, 409);
  }

  const prior = await readKeyframeGeneration(jobId);
  if (prior?.status === 'succeeded') {
    return json({
      ...prior,
      deduplicated: true
    }, 200);
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = clean(body.projectId, 96);
  const storyVersion = clean(body.storyVersion, 96);
  const sceneId = clean(body.sceneId, 96);
  const shotId = clean(body.shotId, 96);
  const specHash = clean(body.specHash, 96);

  if (![projectId, storyVersion, sceneId, shotId, specHash].every((value) => value && safeId(value))) {
    return json({ error: 'Valid projectId, storyVersion, sceneId, shotId and specHash are required.' }, 400);
  }

  const [spec, keyframePlan] = await Promise.all([
    readRenderSpec({ projectId, storyVersion, sceneId, shotId, specHash }),
    readKeyframePlan({ projectId, storyVersion, sceneId, shotId, specHash })
  ]);

  if (!spec) return json({ error: 'The exact ShotRenderSpec was not found.' }, 404);
  if (!keyframePlan || keyframePlan.spec_hash !== spec.spec_hash) {
    return json({
      error: 'Build the exact keyframe plan before generating a first-frame candidate.',
      code: 'KEYFRAME_PLAN_REQUIRED'
    }, 409);
  }

  if (spec.human_review.required_before_final_render) {
    return json({
      error: 'The ShotRenderSpec still contains unresolved human/rights review requirements.',
      code: 'HUMAN_REVIEW_REQUIRED',
      reasons: spec.human_review.reasons,
      hint: 'Resolve Visual Canon rights/review issues before generating a production keyframe.'
    }, 409);
  }

  const maxGenerations = Math.max(
    1,
    Math.min(12, Number(Netlify.env.get('PARABLE_KEYFRAME_MAX_GENERATIONS_PER_SHOT') || 5))
  );
  const priorGenerations = await listShotKeyframeGenerations({
    projectId,
    storyVersion,
    sceneId,
    shotId,
    limit: 250
  });
  const completedAttempts = priorGenerations.filter((record) =>
    record?.status === 'succeeded' || record?.status === 'failed'
  ).length;

  if (!prior && completedAttempts >= maxGenerations) {
    return json({
      error: 'This shot reached the first-frame generation ceiling. Review or repair an existing candidate before spending more.',
      code: 'KEYFRAME_GENERATION_LIMIT_REACHED',
      max_generations_per_shot: maxGenerations,
      completed_attempts: completedAttempts
    }, 409);
  }

  const apiKey = Netlify.env.get('OPENROUTER_API_KEY') || '';
  if (!apiKey) {
    return json({
      error: 'Protected image generation is not configured in this deployment.',
      code: 'KEYFRAME_GENERATOR_NOT_CONFIGURED'
    }, 503);
  }

  const model = clean(
    Netlify.env.get('PARABLE_KEYFRAME_IMAGE_MODEL') || 'google/gemini-3.1-flash-image',
    240
  );
  const generationPlan = buildKeyframeGenerationPlan({ spec, model });

  const startedAt = new Date().toISOString();
  await saveKeyframeGeneration({
    generation_version: 'parable-keyframe-generation-v1',
    id: jobId,
    project_id: projectId,
    story_version: storyVersion,
    scene_id: sceneId,
    shot_id: shotId,
    spec_hash: spec.spec_hash,
    keyframe_plan_hash: clean(body.keyframePlanHash, 96) || null,
    status: 'processing',
    provider: 'openrouter',
    model,
    reference_ids: generationPlan.reference_ids,
    inspiration_note_count: generationPlan.inspiration_notes.length,
    asset_uri: null,
    content_sha256: null,
    media_type: null,
    actual_cost_usd: null,
    usage: null,
    started_at: startedAt,
    completed_at: null,
    error_class: null,
    error: null
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 110000);
  const startedMs = Date.now();

  try {
    const requestBody: Record<string, any> = {
      model: generationPlan.model,
      prompt: generationPlan.prompt,
      n: 1,
      aspect_ratio: generationPlan.aspect_ratio,
      output_format: 'png',
      provider: {
        require_parameters: true,
        allow_fallbacks: true,
        data_collection: 'deny',
        zdr: true,
        sort: 'price'
      }
    };

    if (generationPlan.input_references.length) {
      requestBody.input_references = generationPlan.input_references;
    }

    const response = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: 'Bearer ' + apiKey,
        'content-type': 'application/json',
        'HTTP-Referer': Netlify.env.get('PARABLE_PUBLIC_URL') || 'https://parable-studio.netlify.app',
        'X-OpenRouter-Title': 'PARABLE Keyframe Generator'
      },
      body: JSON.stringify(requestBody)
    });

    const result = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) {
      const reason = clean(
        result?.error?.message || result?.message || result?.detail || ('HTTP ' + response.status),
        1000
      );
      const failed = {
        generation_version: 'parable-keyframe-generation-v1',
        id: jobId,
        project_id: projectId,
        story_version: storyVersion,
        scene_id: sceneId,
        shot_id: shotId,
        spec_hash: spec.spec_hash,
        status: 'failed',
        provider: 'openrouter',
        model,
        reference_ids: generationPlan.reference_ids,
        inspiration_note_count: generationPlan.inspiration_notes.length,
        asset_uri: null,
        content_sha256: null,
        media_type: null,
        actual_cost_usd: money(result?.usage?.cost),
        usage: result?.usage || null,
        latency_ms: Date.now() - startedMs,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        error_class: classifyStatus(response.status),
        error: reason
      };
      await saveKeyframeGeneration(failed);

      return json({
        error: reason,
        code: response.status === 402
          ? 'KEYFRAME_PROVIDER_BUDGET_BLOCKED'
          : response.status === 429
            ? 'KEYFRAME_PROVIDER_RATE_LIMITED'
            : 'KEYFRAME_PROVIDER_FAILED',
        retryable: response.status === 429 || response.status >= 500,
        generation: failed
      }, response.status === 429 || response.status >= 500 ? 503 : 422);
    }

    const item = Array.isArray(result?.data) ? result.data[0] : null;
    const base64 = clean(item?.b64_json, 50_000_000);
    if (!base64) throw new Error('Image provider returned no base64 image payload.');

    const mediaType = clean(item?.media_type || 'image/png', 80);
    const actualCostUsd = money(result?.usage?.cost);
    const asset = await saveKeyframeAsset({
      base64,
      mediaType,
      projectId,
      storyVersion,
      sceneId,
      shotId,
      model: String(result?.model || model),
      provider: 'openrouter',
      generationId: jobId,
      actualCostUsd
    });

    const candidate = {
      generation_version: 'parable-keyframe-generation-v1',
      id: jobId,
      project_id: projectId,
      story_version: storyVersion,
      scene_id: sceneId,
      shot_id: shotId,
      spec_hash: spec.spec_hash,
      status: 'succeeded',
      provider: 'openrouter',
      model: String(result?.model || model),
      reference_ids: generationPlan.reference_ids,
      inspiration_note_count: generationPlan.inspiration_notes.length,
      asset_uri: assetUrl(request, asset.sha256),
      content_sha256: asset.sha256,
      immutable_binding: true,
      media_type: asset.media_type,
      actual_cost_usd: actualCostUsd,
      usage: result?.usage || null,
      latency_ms: Date.now() - startedMs,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error_class: null,
      error: null,
      human_approval_required: true,
      next_action: 'POST /api/keyframe-inspect, then human review via /api/keyframe-approval'
    };

    await saveKeyframeGeneration(candidate);
    return json({
      ...candidate,
      deduplicated: false
    }, 201);
  } catch (error) {
    const reason = clean(error instanceof Error ? error.message : error, 1000) || 'Keyframe generation failed.';
    const failed = {
      generation_version: 'parable-keyframe-generation-v1',
      id: jobId,
      project_id: projectId,
      story_version: storyVersion,
      scene_id: sceneId,
      shot_id: shotId,
      spec_hash: spec.spec_hash,
      status: 'failed',
      provider: 'openrouter',
      model,
      reference_ids: generationPlan.reference_ids,
      inspiration_note_count: generationPlan.inspiration_notes.length,
      asset_uri: null,
      content_sha256: null,
      media_type: null,
      actual_cost_usd: null,
      usage: null,
      latency_ms: Date.now() - startedMs,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error_class: /abort|timeout/i.test(reason) ? 'timeout' : 'other',
      error: reason
    };
    await saveKeyframeGeneration(failed);

    return json({
      error: reason,
      code: /abort|timeout/i.test(reason) ? 'KEYFRAME_PROVIDER_TIMEOUT' : 'KEYFRAME_GENERATION_FAILED',
      retryable: true,
      generation: failed
    }, 503);
  } finally {
    clearTimeout(timer);
  }
};

export const config = {
  path: '/api/keyframe-generate',
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
