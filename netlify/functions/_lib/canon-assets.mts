import { getStore } from '@netlify/blobs';
import { getContext } from '@netlify/functions';
import type { CanonReference, ShotRenderSpec } from './render-foundation.mts';
import { createSignedMediaUrl } from './media-signing.mts';

export type RightsBasis = 'owned' | 'licensed' | 'consent' | 'generated' | 'public-domain' | 'unknown';

export type CanonRightsProvenance = {
  rights_version: 'parable-rights-provenance-v1';
  status: 'approved' | 'unverified' | 'restricted' | 'revoked';
  basis: RightsBasis;
  rights_holder: string | null;
  likeness_permission: boolean;
  voice_permission: boolean;
  ai_generation_permission: boolean;
  commercial_use: boolean;
  territories: string[];
  expires_at: string | null;
  evidence_note: string | null;
  evidence_sha256: string | null;
  declared_by_actor_id: string;
  declared_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
};

export type CanonVaultAsset = {
  asset_version: 'parable-canon-asset-v1';
  sha256: string;
  project_id: string;
  media_type: string;
  byte_length: number;
  original_name: string | null;
  source_url: string | null;
  source_title: string | null;
  source_creator: string | null;
  reference_kind: string;
  render_usage: string;
  rights: CanonRightsProvenance;
  created_at: string;
};

function runtimeScope() {
  let context: any = null;
  try { context = getContext(); } catch {}
  const deployContext = context?.deploy?.context || Netlify.context?.deploy?.context || 'unknown';
  const production = deployContext === 'production';
  const deployId = String(context?.deploy?.id || Netlify.context?.deploy?.id || 'local')
    .replace(/[^a-zA-Z0-9_-]/g,'')
    .slice(0,96);
  return {
    production,
    prefix: production ? '' : 'deploy/' + (deployId || 'local') + '/'
  };
}

function stores() {
  const scope = runtimeScope();
  const suffix = scope.production ? '' : '-sandbox';
  return {
    scope,
    bytes: getStore('parable-canon-assets' + suffix, { consistency: 'strong' }),
    metadata: getStore('parable-canon-asset-meta' + suffix, { consistency: 'strong' }),
    rightsEvents: getStore('parable-rights-events' + suffix, { consistency: 'strong' })
  };
}

const clean = (value: unknown, max = 1800) => String(value ?? '').replace(/\s+/g,' ').trim().slice(0,max);

function decodeBase64(value: string) {
  const normalized = String(value || '').replace(/^data:[^;]+;base64,/i,'').replace(/\s+/g,'');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');
}

function assetKey(projectId: string, hash: string) {
  const { scope } = stores();
  return scope.prefix + 'project/' + projectId + '/asset/' + hash;
}

function metadataKey(projectId: string, hash: string) {
  const { scope } = stores();
  return scope.prefix + 'project/' + projectId + '/meta/' + hash;
}

export function validateRightsForReference(args: {
  referenceKind: string;
  renderUsage: string;
  rights: CanonRightsProvenance;
}) {
  const blockers: string[] = [];
  const rights = args.rights;

  if (rights.status !== 'approved') blockers.push('Rights status is not approved.');
  if (!rights.ai_generation_permission) blockers.push('AI generation permission is not approved.');
  if (rights.expires_at && Date.parse(rights.expires_at) <= Date.now()) blockers.push('Rights approval has expired.');

  if (
    args.renderUsage === 'identity' ||
    args.referenceKind === 'actor-face' ||
    args.referenceKind === 'actor-visual'
  ) {
    if (!rights.likeness_permission && rights.basis !== 'generated') {
      blockers.push('Likeness permission is required for actor identity rendering.');
    }
  }

  if (args.referenceKind === 'voice' || args.renderUsage === 'performance') {
    if (args.referenceKind === 'voice' && !rights.voice_permission && rights.basis !== 'generated') {
      blockers.push('Voice permission is required for voice identity rendering.');
    }
  }

  return {
    allowed: blockers.length === 0,
    blockers
  };
}

export async function saveCanonAsset(args: {
  projectId: string;
  base64: string;
  mediaType: string;
  originalName?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sourceCreator?: string | null;
  referenceKind: string;
  renderUsage: string;
  rights: CanonRightsProvenance;
}) {
  const bytes = decodeBase64(args.base64);
  if (!bytes.byteLength) throw new Error('Canon asset contained no bytes.');
  if (bytes.byteLength > 30 * 1024 * 1024) throw new Error('Canon asset exceeds the 30 MB upload limit.');

  const allowedMedia = /^(image\/(png|jpeg|webp)|audio\/(mpeg|wav|ogg|webm)|video\/mp4)$/i;
  if (!allowedMedia.test(args.mediaType)) throw new Error('Unsupported canon asset media type.');

  const hash = await sha256Bytes(bytes);
  const key = assetKey(args.projectId, hash);
  const existing = await stores().bytes.getMetadata(key);

  if (!existing) {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await stores().bytes.set(key, buffer, { onlyIfNew: true } as any);
  }

  const metadata: CanonVaultAsset = {
    asset_version: 'parable-canon-asset-v1',
    sha256: hash,
    project_id: args.projectId,
    media_type: args.mediaType.toLowerCase(),
    byte_length: bytes.byteLength,
    original_name: clean(args.originalName, 260) || null,
    source_url: clean(args.sourceUrl, 1800) || null,
    source_title: clean(args.sourceTitle, 260) || null,
    source_creator: clean(args.sourceCreator, 260) || null,
    reference_kind: clean(args.referenceKind, 80),
    render_usage: clean(args.renderUsage, 80),
    rights: args.rights,
    created_at: new Date().toISOString()
  };

  await stores().metadata.setJSON(metadataKey(args.projectId, hash), metadata);

  const now = new Date().toISOString();
  await stores().rightsEvents.setJSON(
    stores().scope.prefix + 'project/' + args.projectId + '/rights/' + hash + '/' + now.replace(/[:.]/g,'-'),
    {
      rights_event_version: 'parable-rights-event-v1',
      asset_sha256: hash,
      project_id: args.projectId,
      rights: args.rights,
      at: now
    }
  );

  return metadata;
}

export async function readCanonAsset(projectId: string, hash: string) {
  if (!/^[a-f0-9]{64}$/i.test(hash)) return null;
  const [bytes, metadata] = await Promise.all([
    stores().bytes.get(assetKey(projectId, hash), { type:'arrayBuffer' }) as Promise<ArrayBuffer|null>,
    stores().metadata.get(metadataKey(projectId, hash), { type:'json' }) as Promise<CanonVaultAsset|null>
  ]);
  if (!bytes || !metadata) return null;
  return { bytes, metadata };
}

export async function readCanonAssetMetadata(projectId: string, hash: string) {
  if (!/^[a-f0-9]{64}$/i.test(hash)) return null;
  return stores().metadata.get(metadataKey(projectId, hash), { type:'json' }) as Promise<CanonVaultAsset|null>;
}

export async function revokeCanonAssetRights(args: {
  projectId: string;
  hash: string;
  actorId: string;
  reason: string;
}) {
  const current = await readCanonAssetMetadata(args.projectId, args.hash);
  if (!current) return null;

  const now = new Date().toISOString();
  const rights: CanonRightsProvenance = {
    ...current.rights,
    status: 'revoked',
    revoked_at: now,
    revoke_reason: clean(args.reason, 800) || 'Rights revoked by PARABLE project administrator.'
  };
  const next: CanonVaultAsset = { ...current, rights };

  await stores().metadata.setJSON(metadataKey(args.projectId,args.hash), next);
  await stores().rightsEvents.setJSON(
    stores().scope.prefix + 'project/' + args.projectId + '/rights/' + args.hash + '/' + now.replace(/[:.]/g,'-'),
    {
      rights_event_version: 'parable-rights-event-v1',
      asset_sha256: args.hash,
      project_id: args.projectId,
      action: 'revoke',
      actor_id: args.actorId,
      reason: rights.revoke_reason,
      rights,
      at: now
    }
  );

  return next;
}

export async function signedCanonAssetUrl(args: {
  projectId: string;
  hash: string;
  purpose?: string;
  ttlSeconds?: number;
}) {
  return createSignedMediaUrl({
    route: '/api/canon-asset',
    assetId: args.hash,
    projectId: args.projectId,
    purpose: args.purpose || 'renderer',
    ttlSeconds: args.ttlSeconds || 1200
  });
}

export async function hydrateRenderSpecReferences(spec: ShotRenderSpec) {
  const hydrate = async (ref: CanonReference): Promise<CanonReference> => {
    const hash = String((ref as any).asset_sha256 || '').toLowerCase();
    if (!hash) return ref;

    const meta = await readCanonAssetMetadata(spec.project_id, hash);
    if (!meta) throw new Error('Canon asset ' + hash.slice(0,12) + ' is missing from the immutable vault.');

    const rights = validateRightsForReference({
      referenceKind: ref.kind,
      renderUsage: String(ref.render_usage || ''),
      rights: meta.rights
    });

    if (!rights.allowed) {
      throw new Error(
        'Canon asset ' + hash.slice(0,12) + ' is not authorized for rendering: ' + rights.blockers.join(' ')
      );
    }

    return {
      ...ref,
      uri: await signedCanonAssetUrl({
        projectId: spec.project_id,
        hash,
        purpose: 'renderer',
        ttlSeconds: 1200
      })
    };
  };

  return {
    ...spec,
    references: await Promise.all((spec.references || []).map(hydrate))
  } as ShotRenderSpec;
}
