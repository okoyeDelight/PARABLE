import { buildKeyframeGenerationPlan } from './_lib/keyframe-generation-core.mts';
import {
  listShotKeyframeGenerations,
  readKeyframeGeneration,
  saveKeyframeAsset,
  signedKeyframeAssetUrl,
  saveKeyframeGeneration
} from './_lib/keyframe-assets.mts';
import { readKeyframePlan, readRenderSpec } from './_lib/render-store.mts';
import { hydrateRenderSpecReferences } from './_lib/canon-assets.mts';
import {
  acknowledgeProviderSubmission,
  beginProviderSubmission,
  ensureProviderTransaction,
  failProviderTransaction,
  markProviderSubmissionAmbiguous,
  settleProviderTransaction
} from './_lib/provider-transactions.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

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

function freeDevDimensions(aspectRatio: string) {
  const map: Record<string, [number, number]> = {
    '16:9': [768, 432], '9:16': [432, 768], '1:1': [640, 640],
    '4:3': [704, 528], '3:4': [528, 704], '21:9': [840, 360]
  };
  return map[aspectRatio] || map['16:9'];
}

function seedFromHash(value: string) {
  const slice = value.replace(/[^a-f0-9]/gi, '').slice(0, 8);
  return Math.max(1, parseInt(slice || '1', 16) % 2147483646);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + size, bytes.length)));
  }
  return btoa(binary);
}

async function generateFreeDevelopmentKeyframe(args: {
  jobId: string;
  projectId: string;
  storyVersion: string;
  sceneId: string;
  shotId: string;
  specHash: string;
  spec: any;
  requestOrigin: string;
}) {
  if (Netlify.context?.deploy?.context !== 'deploy-preview') {
    return json({
      error: 'The zero-cost development visual route is available only on isolated Deploy Previews.',
      code: 'FREE_DEV_VISUAL_PREVIEW_ONLY'
    }, 403);
  }

  const refs = Array.isArray(args.spec?.references) ? args.spec.references : [];
  const previousHandoff = args.spec?.world_state?.previous_accepted_handoff?.handoff_frame?.uri;
  if (refs.length || previousHandoff) {
    return json({
      error: 'This free development visual route is text-only and cannot safely preserve locked identity/reference imagery. Use it before identity references are locked, or configure a reference-capable production renderer.',
      code: 'FREE_DEV_VISUAL_REFERENCES_UNSUPPORTED'
    }, 409);
  }

  const [width, height] = freeDevDimensions(String(args.spec?.output?.aspect_ratio || '16:9'));
  const prompt = [
    'photorealistic cinematic live-action film still, serious narrative movie frame,',
    'story beat: ' + clean(args.spec?.narrative?.beat, 420),
    'dramatic purpose: ' + clean(args.spec?.narrative?.dramatic_purpose, 280),
    'emotion: ' + clean(args.spec?.narrative?.emotional_intent, 280),
    'camera: ' + clean(args.spec?.camera?.shot_type, 120) + ' ' + clean(args.spec?.camera?.lens_mm, 20) + 'mm,',
    'composition: ' + clean(args.spec?.composition?.grammar, 120) + ',',
    'lighting: ' + clean(args.spec?.lighting?.direction, 260) + ',',
    'performance: ' + clean(args.spec?.performance?.direction, 260) + ',',
    'culturally grounded Nigerian/African production design when supported by the story,',
    'natural skin and texture, physically coherent hands and architecture, no poster, no title, no subtitles, no UI, no glamour lighting'
  ].join(' ').replace(/\s+/g, ' ').trim().slice(0, 1500);

  const model = 'flux';
  const seed = seedFromHash(args.specHash);
  const endpoint = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt)
    + '?model=' + encodeURIComponent(model)
    + '&width=' + width
    + '&height=' + height
    + '&seed=' + seed
    + '&enhance=false';

  const startedAt = new Date().toISOString();
  await saveKeyframeGeneration({
    generation_version: 'parable-keyframe-generation-v1',
    id: args.jobId,
    project_id: args.projectId,
    story_version: args.storyVersion,
    scene_id: args.sceneId,
    shot_id: args.shotId,
    spec_hash: args.specHash,
    status: 'processing',
    provider: 'pollinations-dev',
    model,
    reference_ids: [],
    inspiration_note_count: 0,
    asset_uri: null,
    content_sha256: null,
    media_type: null,
    actual_cost_usd: 0,
    usage: null,
    started_at: startedAt,
    completed_at: null,
    error_class: null,
    error: null,
    development_only: true
  } as any);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  const startedMs = Date.now();

  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,*/*' },
      redirect: 'follow'
    });
    if (!response.ok) {
      throw new Error('Free development image provider returned HTTP ' + response.status + '.');
    }
    const mediaType = clean(response.headers.get('content-type') || 'image/jpeg', 80).split(';')[0].toLowerCase();
    if (!/^image\/(jpeg|png|webp)$/i.test(mediaType)) {
      throw new Error('Free development image provider returned an unsupported media type: ' + mediaType);
    }
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength || buffer.byteLength > 15 * 1024 * 1024) {
      throw new Error('Free development image response was empty or exceeded the 15 MB safety ceiling.');
    }

    const asset = await saveKeyframeAsset({
      base64: bytesToBase64(new Uint8Array(buffer)),
      mediaType,
      projectId: args.projectId,
      storyVersion: args.storyVersion,
      sceneId: args.sceneId,
      shotId: args.shotId,
      model,
      provider: 'pollinations-dev',
      generationId: args.jobId,
      actualCostUsd: 0
    });

    const candidate = {
      generation_version: 'parable-keyframe-generation-v1',
      id: args.jobId,
      project_id: args.projectId,
      story_version: args.storyVersion,
      scene_id: args.sceneId,
      shot_id: args.shotId,
      spec_hash: args.specHash,
      status: 'succeeded',
      provider: 'pollinations-dev',
      model,
      reference_ids: [],
      inspiration_note_count: 0,
      asset_uri: await signedKeyframeAssetUrl({
        projectId: args.projectId,
        hash: asset.sha256,
        purpose: 'preview',
        ttlSeconds: 900,
        origin: args.requestOrigin
      }),
      content_sha256: asset.sha256,
      immutable_binding: true,
      media_type: asset.media_type,
      actual_cost_usd: 0,
      usage: null,
      latency_ms: Date.now() - startedMs,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error_class: null,
      error: null,
      human_approval_required: true,
      development_only: true,
      production_eligible: false,
      privacy_mode: 'third-party-free-development-explicit-opt-in',
      watermark_possible: true,
      next_action: 'Run Visual Inspector and human review. Do not treat this development provider as a confidential production renderer.'
    };
    await saveKeyframeGeneration(candidate as any);
    return json(candidate, 201);
  } catch (error) {
    const reason = clean(error instanceof Error ? error.message : error, 1000) || 'Free development keyframe generation failed.';
    const failed = {
      generation_version: 'parable-keyframe-generation-v1',
      id: args.jobId,
      project_id: args.projectId,
      story_version: args.storyVersion,
      scene_id: args.sceneId,
      shot_id: args.shotId,
      spec_hash: args.specHash,
      status: 'failed',
      provider: 'pollinations-dev',
      model,
      reference_ids: [],
      inspiration_note_count: 0,
      asset_uri: null,
      content_sha256: null,
      media_type: null,
      actual_cost_usd: 0,
      usage: null,
      latency_ms: Date.now() - startedMs,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error_class: /abort|timeout/i.test(reason) ? 'timeout' : 'free-development-provider',
      error: reason,
      development_only: true
    };
    await saveKeyframeGeneration(failed as any);
    return json({
      error: reason,
      code: 'FREE_DEV_VISUAL_FAILED',
      retryable: true,
      generation: failed
    }, 503);
  } finally {
    clearTimeout(timer);
  }
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
  const requestOrigin = new URL(request.url).origin;
  const projectId = clean(body.projectId, 96);
  const storyVersion = clean(body.storyVersion, 96);
  const sceneId = clean(body.sceneId, 96);
  const shotId = clean(body.shotId, 96);
  const specHash = clean(body.specHash, 96);

  if (![projectId, storyVersion, sceneId, shotId, specHash].every((value) => value && safeId(value))) {
    return json({ error: 'Valid projectId, storyVersion, sceneId, shotId and specHash are required.' }, 400);
  }

  try {
    const access = await authorizeProject(request, projectId, 'render:spend');
    if (!access.actor.internal) {
      return json({
        error: 'Billable keyframe generation can only be executed by a trusted PARABLE worker.',
        code: 'INTERNAL_RENDER_WORKER_REQUIRED'
      }, 403);
    }
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
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
    const reasons = Array.isArray(spec.human_review.reasons) ? spec.human_review.reasons : [];
    const hardReasons = reasons.filter((reason: unknown) =>
      /rights|likeness|voice|camera-axis|spatial|blocker|unverified reference/i.test(String(reason || ''))
    );
    // A development still exists so the human can review uncertain film choices.
    // It may bypass only advisory Continuity-Brain review, never rights/spatial
    // blockers, and it can never become production-eligible automatically.
    const developmentReviewOnly = body.freeDevelopment === true && hardReasons.length === 0;
    if (!developmentReviewOnly) {
      return json({
        error: 'The ShotRenderSpec still contains unresolved human/rights review requirements.',
        code: 'HUMAN_REVIEW_REQUIRED',
        reasons,
        hard_reasons: hardReasons,
        hint: 'Resolve Visual Canon rights/spatial blockers before generation. Advisory continuity review may use the explicit free-development still route.'
      }, 409);
    }
  }

  const configuredMaxGenerations = Number(Netlify.env.get('PARABLE_KEYFRAME_MAX_GENERATIONS_PER_SHOT') || 5);
  const maxGenerations = Number.isFinite(configuredMaxGenerations)
    ? Math.max(1, Math.min(12, Math.floor(configuredMaxGenerations)))
    : 5;
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

  if (body.freeDevelopment === true) {
    if (body.nonConfidentialConfirmed !== true) {
      return json({
        error: 'Free development visual generation requires explicit confirmation that this is a non-confidential test story.',
        code: 'FREE_DEV_VISUAL_CONFIRMATION_REQUIRED'
      }, 400);
    }
    return generateFreeDevelopmentKeyframe({
      jobId,
      projectId,
      storyVersion,
      sceneId,
      shotId,
      specHash,
      spec,
      requestOrigin
    });
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
  const hydratedSpec = await hydrateRenderSpecReferences(spec);
  const generationPlan = buildKeyframeGenerationPlan({ spec: hydratedSpec, model });

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

    const transactionState = await ensureProviderTransaction({
      projectId,
      operationType: 'keyframe-image-generation',
      operationId: jobId,
      provider: 'openrouter',
      model,
      requestBody,
      estimatedCostUsd: null
    });
    const transaction = await beginProviderSubmission(transactionState.transaction.id);

    if (['acknowledged','processing','settled'].includes(transaction.state)) {
      return json({
        error: 'This keyframe provider transaction already reached the provider. PARABLE will not submit it again.',
        code: 'KEYFRAME_PROVIDER_ALREADY_SUBMITTED',
        retryable: false,
        provider_transaction: transaction
      }, 409);
    }

    let response: Response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/images', {
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
    } catch (error) {
      const reason = clean(error instanceof Error ? error.message : error, 1000) || 'Image provider connection failed.';
      const ambiguous = await markProviderSubmissionAmbiguous({
        id: transaction.id,
        detail: reason
      });
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
        error_class: 'ambiguous-submission',
        error: reason,
        provider_transaction_id: transaction.id
      };
      await saveKeyframeGeneration(failed);

      return json({
        error: 'The image provider may already have received this paid request. PARABLE locked it instead of retrying automatically.',
        code: 'PROVIDER_SUBMISSION_AMBIGUOUS',
        retryable: false,
        provider_transaction: ambiguous,
        generation: failed
      }, 409);
    }

    const result = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) {
      const reason = clean(
        result?.error?.message || result?.message || result?.detail || ('HTTP ' + response.status),
        1000
      );

      if (response.status >= 500) {
        const ambiguous = await markProviderSubmissionAmbiguous({
          id: transaction.id,
          detail: reason || ('HTTP ' + response.status)
        });
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
          error_class: 'ambiguous-submission',
          error: reason,
          provider_transaction_id: transaction.id
        };
        await saveKeyframeGeneration(failed);
        return json({
          error: 'The image provider returned an uncertain server response after submission. PARABLE will not auto-retry.',
          code: 'PROVIDER_SUBMISSION_AMBIGUOUS',
          retryable: false,
          provider_transaction: ambiguous,
          generation: failed
        }, 409);
      }

      await failProviderTransaction({
        id: transaction.id,
        failureClass: classifyStatus(response.status),
        failureDetail: reason,
        actualCostUsd: money(result?.usage?.cost)
      }).catch(() => null);
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
        retryable: false,
        generation: failed
      }, response.status === 429 ? 429 : 422);
    }

    const providerRequestId = clean(result?.id || result?.request_id, 400) || ('openrouter-sync:' + jobId);
    const acknowledged = await acknowledgeProviderSubmission({
      id: transaction.id,
      providerRequestId
    });

    const item = Array.isArray(result?.data) ? result.data[0] : null;
    const base64 = clean(item?.b64_json, 50_000_000);
    if (!base64) {
      await failProviderTransaction({
        id: transaction.id,
        failureClass: 'provider-malformed-success',
        failureDetail: 'Image provider returned success without image bytes.',
        actualCostUsd: money(result?.usage?.cost)
      }).catch(() => null);
      throw new Error('Image provider returned no base64 image payload.');
    }

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
      asset_uri: await signedKeyframeAssetUrl({
        projectId,
        hash: asset.sha256,
        purpose: 'preview',
        ttlSeconds: 900,
        origin: requestOrigin
      }),
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
      provider_transaction_id: transaction.id,
      human_approval_required: true,
      next_action: 'POST /api/keyframe-inspect, then human review via /api/keyframe-approval'
    };

    await settleProviderTransaction({
      id: transaction.id,
      actualCostUsd
    }).catch(() => null);

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
