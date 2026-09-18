import { getDeployStore, getStore } from '@netlify/blobs';

function stores() {
  const production = Netlify.context?.deploy?.context === 'production';
  const make = (name: string) => production
    ? getStore(name, { consistency: 'strong' })
    : getDeployStore(name);

  return {
    assets: make('parable-keyframe-assets'),
    meta: make('parable-keyframe-asset-meta'),
    generations: make('parable-keyframe-generations')
  };
}

const safeHash = (value: string) => /^[a-f0-9]{64}$/i.test(String(value || ''));

export async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function decodeBase64(value: string) {
  const normalized = String(value || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function saveKeyframeAsset(args: {
  base64: string;
  mediaType: string;
  projectId: string;
  storyVersion: string;
  sceneId: string;
  shotId: string;
  model: string;
  provider: string;
  generationId: string;
  actualCostUsd?: number | null;
}) {
  const bytes = decodeBase64(args.base64);
  if (!bytes.byteLength) throw new Error('Generated keyframe contained no image bytes.');
  if (bytes.byteLength > 30 * 1024 * 1024) throw new Error('Generated keyframe exceeds the 30 MB asset limit.');

  const hash = await sha256Bytes(bytes);
  const assetKey = 'asset/' + hash;
  const mediaType = /^image\/(png|jpeg|webp)$/i.test(args.mediaType)
    ? args.mediaType.toLowerCase()
    : 'image/png';

  const existing = await stores().assets.getMetadata(assetKey);
  if (!existing) {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await stores().assets.set(assetKey, buffer);
  }

  const metadata = {
    asset_version: 'parable-keyframe-asset-v1',
    sha256: hash,
    media_type: mediaType,
    byte_length: bytes.byteLength,
    project_id: args.projectId,
    story_version: args.storyVersion,
    scene_id: args.sceneId,
    shot_id: args.shotId,
    provider: args.provider,
    model: args.model,
    generation_id: args.generationId,
    actual_cost_usd: Number.isFinite(Number(args.actualCostUsd))
      ? Math.max(0, Number(args.actualCostUsd))
      : null,
    created_at: new Date().toISOString()
  };

  await stores().meta.setJSON('meta/' + hash, metadata);

  return metadata;
}

export async function readKeyframeAsset(hash: string) {
  if (!safeHash(hash)) return null;
  const [bytes, metadata] = await Promise.all([
    stores().assets.get('asset/' + hash, { type: 'arrayBuffer' }) as Promise<ArrayBuffer | null>,
    stores().meta.get('meta/' + hash, { type: 'json' }) as Promise<Record<string, any> | null>
  ]);
  if (!bytes || !metadata) return null;
  return { bytes, metadata };
}

const safePart = (value: unknown) => String(value || '')
  .replace(/[^a-zA-Z0-9_.:-]/g, '_')
  .slice(0, 180);

function shotGenerationPrefix(record: Record<string, any>) {
  return [
    'shot',
    safePart(record.project_id),
    safePart(record.story_version),
    safePart(record.scene_id),
    safePart(record.shot_id)
  ].join('/') + '/';
}

export async function saveKeyframeGeneration(record: Record<string, any>) {
  const id = safePart(record.id);
  const key = 'generation/' + id;
  const shotKey = shotGenerationPrefix(record) + id;
  const latestKey = [
    'latest',
    safePart(record.project_id),
    safePart(record.story_version),
    safePart(record.scene_id),
    safePart(record.shot_id),
    safePart(record.spec_hash)
  ].join('/');

  await Promise.all([
    stores().generations.setJSON(key, record),
    stores().generations.setJSON(shotKey, record),
    stores().generations.setJSON(latestKey, record)
  ]);
  return key;
}

export async function readKeyframeGeneration(id: string) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
  if (!safe) return null;
  return stores().generations.get('generation/' + safe, { type: 'json' }) as Promise<Record<string, any> | null>;
}

export async function listShotKeyframeGenerations(args: {
  projectId: string;
  storyVersion: string;
  sceneId: string;
  shotId: string;
  limit?: number;
}) {
  const prefix = [
    'shot',
    safePart(args.projectId),
    safePart(args.storyVersion),
    safePart(args.sceneId),
    safePart(args.shotId)
  ].join('/') + '/';
  const { blobs } = await stores().generations.list({ prefix });
  const selected = blobs.slice(-Math.max(1, Math.min(500, args.limit || 150)));
  const values = await Promise.all(
    selected.map(({ key }) =>
      stores().generations.get(key, { type: 'json' }) as Promise<Record<string, any> | null>
    )
  );
  return values.filter(Boolean) as Record<string, any>[];
}
