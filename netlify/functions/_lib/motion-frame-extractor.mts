import { getDeployStore, getStore } from '@netlify/blobs';
import {
  ingestTrustedMotionFrame,
  signedMotionFrameUrl
} from './motion-frame-assets.mts';
import {
  acknowledgeProviderSubmission,
  beginProviderSubmission,
  ensureProviderTransaction,
  failProviderTransaction,
  markProviderProcessing,
  markProviderSubmissionAmbiguous,
  readProviderTransaction,
  settleProviderTransaction,
  ProviderTransactionError
} from './provider-transactions.mts';
import type { RenderAttempt, ShotRenderSpec } from './render-foundation.mts';
import type { MotionFrameEvidence } from './motion-inspector-ai.mts';

export type MotionFrameSet = {
  frame_set_version: 'parable-motion-frame-set-v1';
  attempt_id: string;
  project_id: string;
  story_version: string;
  scene_id: string;
  shot_id: string;
  spec_hash: string;
  asset_uri: string;
  provider: 'fal';
  endpoint: 'fal-ai/workflow-utilities/extract-nth-frame';
  provider_transaction_id: string;
  provider_request_id: string;
  fps: number;
  duration_seconds: number;
  frame_interval: number;
  frames: MotionFrameEvidence[];
  created_at: string;
};

function stores() {
  const production = Netlify.context?.deploy?.context === 'production';
  const make = (name: string) => production
    ? getStore(name, { consistency: 'strong' })
    : getDeployStore(name);
  return {
    frameSets: make('parable-motion-frame-sets')
  };
}

const clean = (value: unknown, max = 1800) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const safeHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
};

function key(attemptId: string) {
  return 'attempt/' + String(attemptId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
}

async function readCached(attempt: RenderAttempt) {
  const cached = await stores().frameSets.get(key(attempt.id), { type: 'json' }) as MotionFrameSet | null;
  if (!cached) return null;
  if (
    cached.attempt_id !== attempt.id ||
    cached.asset_uri !== attempt.asset_uri ||
    cached.spec_hash !== attempt.spec_hash
  ) return null;
  return cached;
}

async function saveCached(value: MotionFrameSet) {
  await stores().frameSets.setJSON(key(value.attempt_id), value);
  return value;
}

function falUrls(endpoint: string, requestId: string) {
  const base = 'https://queue.fal.run/' + endpoint + '/requests/' + encodeURIComponent(requestId);
  return {
    status: base + '/status',
    response: base + '/response'
  };
}

function parseRequestId(body: any) {
  return clean(body?.request_id || body?.requestId || body?.id, 320);
}

function extractionPlan(spec: ShotRenderSpec) {
  const fps = Math.max(12, Math.min(60, Math.round(Number(spec.output?.fps || 24))));
  const duration = Math.max(1, Math.min(20, Number(spec.output?.duration_seconds || 6)));
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const target = Math.max(5, Math.min(10, Number(Netlify.env.get('PARABLE_MOTION_SAMPLE_TARGET') || 8)));
  const frameInterval = Math.max(1, Math.floor(totalFrames / Math.max(1, target - 1)));
  return {
    fps,
    duration,
    totalFrames,
    target,
    frameInterval
  };
}

async function pollFal(args: {
  endpoint: string;
  requestId: string;
  projectId: string;
  transactionId: string;
  timeoutMs?: number;
}) {
  const key = Netlify.env.get('FAL_KEY') || '';
  if (!key) throw new Error('FAL_KEY is not configured for motion-frame extraction.');

  const urls = falUrls(args.endpoint, args.requestId);
  const deadline = Date.now() + Math.max(5000, Math.min(90000, args.timeoutMs || 70000));

  while (Date.now() < deadline) {
    const response = await fetch(urls.status, {
      headers: { authorization: 'Key ' + key },
      signal: AbortSignal.timeout(9000)
    });
    const body = await response.json().catch(() => ({})) as any;

    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        continue;
      }
      throw Object.assign(
        new Error(clean(body?.detail || body?.message || ('FAL status HTTP ' + response.status), 1000)),
        { definitive: true }
      );
    }

    const state = clean(body?.status, 80).toUpperCase();
    if (state === 'IN_QUEUE') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    if (state === 'IN_PROGRESS') {
      await markProviderProcessing(args.transactionId, args.projectId).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }

    if (state !== 'COMPLETED') {
      throw Object.assign(new Error('Unknown FAL frame-extraction status: ' + (state || 'empty')), {
        definitive: false
      });
    }

    const resultResponse = await fetch(urls.response, {
      headers: { authorization: 'Key ' + key },
      signal: AbortSignal.timeout(10000)
    });
    const result = await resultResponse.json().catch(() => ({})) as any;

    if (!resultResponse.ok) {
      throw Object.assign(
        new Error(clean(result?.detail || result?.message || ('FAL result HTTP ' + resultResponse.status), 1000)),
        { definitive: resultResponse.status < 500 && resultResponse.status !== 429 }
      );
    }

    return result?.data && typeof result.data === 'object' ? result.data : result;
  }

  throw Object.assign(new Error('Motion-frame extraction did not complete before the worker deadline.'), {
    retryablePoll: true
  });
}

function frameSetFromResult(args: {
  attempt: RenderAttempt;
  spec: ShotRenderSpec;
  endpoint: string;
  transactionId: string;
  providerRequestId: string;
  result: any;
}) {
  const plan = extractionPlan(args.spec);
  const images = Array.isArray(args.result?.images) ? args.result.images : [];
  if (images.length < 3) throw new Error('Frame extractor returned fewer than three usable frames.');

  const frames = images.slice(0, 10).flatMap((image: any, index: number) => {
    const uri = clean(image?.url, 1800);
    if (!uri || !safeHttpUrl(uri)) return [];
    const timestamp = Math.min(
      plan.duration,
      Math.round((index * plan.frameInterval / plan.fps) * 1000) / 1000
    );
    return [{
      uri,
      timestamp_seconds: timestamp,
      role: index === 0
        ? 'first' as const
        : index === Math.min(images.length, 10) - 1
          ? 'handoff' as const
          : 'sample' as const
    }];
  });

  return {
    frame_set_version: 'parable-motion-frame-set-v1' as const,
    attempt_id: args.attempt.id,
    project_id: args.attempt.project_id,
    story_version: args.attempt.story_version,
    scene_id: args.attempt.scene_id,
    shot_id: args.attempt.shot_id,
    spec_hash: args.attempt.spec_hash,
    asset_uri: args.attempt.asset_uri || '',
    provider: 'fal' as const,
    endpoint: 'fal-ai/workflow-utilities/extract-nth-frame' as const,
    provider_transaction_id: args.transactionId,
    provider_request_id: args.providerRequestId,
    fps: plan.fps,
    duration_seconds: plan.duration,
    frame_interval: plan.frameInterval,
    frames,
    created_at: new Date().toISOString()
  } satisfies MotionFrameSet;
}

export async function extractMotionFrames(args: {
  attempt: RenderAttempt;
  spec: ShotRenderSpec;
}) {
  if (!args.attempt.asset_uri || !safeHttpUrl(args.attempt.asset_uri)) {
    throw new Error('Completed render has no valid video asset URI.');
  }

  const cached = await readCached(args.attempt);
  if (cached) return { frameSet: cached, deduplicated: true };

  const endpoint = 'fal-ai/workflow-utilities/extract-nth-frame';
  const plan = extractionPlan(args.spec);
  const body = {
    video_url: args.attempt.asset_uri,
    frame_interval: plan.frameInterval,
    output_format: 'jpg',
    max_frames: plan.target,
    quality: 84
  };

  // Conservative reserve based on the current FAL utility price of
  // $0.001 / compute second. The settled provider record remains the source of
  // truth if provider-side cost telemetry becomes available.
  const reserveUsd = Math.max(
    0.005,
    Math.min(0.1, Number(Netlify.env.get('PARABLE_MOTION_EXTRACTION_RESERVE_USD') || 0.03))
  );

  const ensured = await ensureProviderTransaction({
    projectId: args.attempt.project_id,
    operationType: 'motion-frame-extraction',
    operationId: args.attempt.id + ':' + args.attempt.spec_hash,
    provider: 'fal',
    model: endpoint,
    requestBody: body,
    estimatedCostUsd: reserveUsd
  });

  let transaction = ensured.transaction;
  if (transaction.state === 'settled') {
    const cachedAfter = await readCached(args.attempt);
    if (cachedAfter) return { frameSet: cachedAfter, deduplicated: true };
    if (!transaction.provider_request_id) {
      throw new ProviderTransactionError(
        'PROVIDER_RESULT_REFERENCE_MISSING',
        'Frame extraction settled but its provider request id is missing.',
        transaction
      );
    }
  }

  const key = Netlify.env.get('FAL_KEY') || '';
  if (!key) throw new Error('FAL_KEY is not configured for motion-frame extraction.');

  if (transaction.state === 'planned') {
    transaction = await beginProviderSubmission(transaction.id, args.attempt.project_id);

    let response: Response;
    try {
      response = await fetch('https://queue.fal.run/' + endpoint, {
        method: 'POST',
        headers: {
          authorization: 'Key ' + key,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000)
      });
    } catch (error) {
      await markProviderSubmissionAmbiguous({
        id: transaction.id,
        projectId: args.attempt.project_id,
        detail: 'FAL frame-extraction submission transport failed after PARABLE claimed the paid operation: ' +
          clean(error instanceof Error ? error.message : error, 800)
      }).catch(() => null);
      throw new ProviderTransactionError(
        'PROVIDER_SUBMISSION_AMBIGUOUS',
        'PARABLE cannot prove whether frame extraction reached FAL, so it will not resubmit automatically.',
        await readProviderTransaction(transaction.id, args.attempt.project_id)
      );
    }

    const responseBody = await response.json().catch(() => ({})) as any;
    if (!response.ok) {
      const detail = clean(
        responseBody?.detail || responseBody?.message || responseBody?.error?.message || ('FAL HTTP ' + response.status),
        1000
      );

      if (response.status === 429 || response.status >= 500) {
        await markProviderSubmissionAmbiguous({
          id: transaction.id,
          projectId: args.attempt.project_id,
          detail: 'FAL returned an ambiguous submission response after claim: ' + detail
        }).catch(() => null);
        throw new ProviderTransactionError(
          'PROVIDER_SUBMISSION_AMBIGUOUS',
          'PARABLE will not duplicate a possibly accepted FAL extraction request.',
          await readProviderTransaction(transaction.id, args.attempt.project_id)
        );
      }

      await failProviderTransaction({
        id: transaction.id,
        projectId: args.attempt.project_id,
        failureClass: 'provider-rejected',
        failureDetail: detail
      }).catch(() => null);
      throw Object.assign(new Error(detail), { definitive: true });
    }

    const requestId = parseRequestId(responseBody);
    if (!requestId) {
      await markProviderSubmissionAmbiguous({
        id: transaction.id,
        projectId: args.attempt.project_id,
        detail: 'FAL acknowledged frame extraction without a durable request id.'
      }).catch(() => null);
      throw new ProviderTransactionError(
        'PROVIDER_SUBMISSION_AMBIGUOUS',
        'FAL returned success without a durable request id; PARABLE will not resubmit.',
        await readProviderTransaction(transaction.id, args.attempt.project_id)
      );
    }

    transaction = await acknowledgeProviderSubmission({
      id: transaction.id,
      projectId: args.attempt.project_id,
      providerRequestId: requestId,
      statusUrl: clean(responseBody?.status_url, 1800) || null,
      responseUrl: clean(responseBody?.response_url, 1800) || null
    });
  }

  if (transaction.state === 'submitting' || transaction.state === 'ambiguous') {
    throw new ProviderTransactionError(
      'PROVIDER_SUBMISSION_AMBIGUOUS',
      'The frame-extraction submission is ambiguous; automatic retry is disabled.',
      transaction
    );
  }

  if (transaction.state === 'failed' || transaction.state === 'cancelled') {
    throw new ProviderTransactionError(
      'PROVIDER_TRANSACTION_TERMINAL',
      'The frame-extraction transaction is terminal; a deliberate new operation is required.',
      transaction
    );
  }

  const requestId = transaction.provider_request_id;
  if (!requestId) {
    throw new ProviderTransactionError(
      'PROVIDER_RESULT_REFERENCE_MISSING',
      'Frame extraction has no durable provider request id.',
      transaction
    );
  }

  let result: any;
  try {
    result = await pollFal({
      endpoint,
      requestId,
      projectId: args.attempt.project_id,
      transactionId: transaction.id
    });
  } catch (error: any) {
    // Once FAL has returned a durable request id, polling can be retried safely:
    // it does not purchase a second extraction.
    if (error?.definitive === true) {
      await failProviderTransaction({
        id: transaction.id,
        projectId: args.attempt.project_id,
        failureClass: 'provider-result-failed',
        failureDetail: clean(error?.message, 1000)
      }).catch(() => null);
    }
    throw error;
  }

  const frameSet = frameSetFromResult({
    attempt: args.attempt,
    spec: args.spec,
    endpoint,
    transactionId: transaction.id,
    providerRequestId: requestId,
    result
  });

  // Evidence is copied into PARABLE-owned content-addressed storage before QA,
  // and the inspector receives signed URLs for those exact immutable bytes.
  const trustedFrames = await Promise.all(
    frameSet.frames.map(async (frame) => {
      const asset = await ingestTrustedMotionFrame({
        projectId: args.attempt.project_id,
        attemptId: args.attempt.id,
        sourceUrl: frame.uri,
        sourceProvider: 'fal',
        sourceRequestId: requestId,
        role: frame.role || 'sample',
        timestampSeconds: frame.timestamp_seconds
      });

      const uri = await signedMotionFrameUrl({
        projectId: args.attempt.project_id,
        hash: asset.sha256,
        purpose: 'motion-inspector',
        ttlSeconds: 3600
      });

      return {
        ...frame,
        uri,
        sha256: asset.sha256
      };
    })
  );
  frameSet.frames = trustedFrames;

  await saveCached(frameSet);
  await settleProviderTransaction({
    id: transaction.id,
    projectId: args.attempt.project_id
  });

  return {
    frameSet,
    deduplicated: false
  };
}

export async function readMotionFrameSet(attemptId: string) {
  return stores().frameSets.get(key(attemptId), { type: 'json' }) as Promise<MotionFrameSet | null>;
}
