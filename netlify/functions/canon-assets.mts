import {
  readCanonAssetMetadata,
  revokeCanonAssetRights,
  saveCanonAsset,
  signedCanonAssetUrl,
  validateRightsForReference,
  type CanonRightsProvenance
} from './_lib/canon-assets.mts';
import {
  authorizeProject,
  securityErrorResponse
} from './_lib/security.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 1800) => String(value ?? '').replace(/\s+/g,' ').trim().slice(0,max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,180}$/.test(value);

function normalizeRights(input: Record<string, any>, actorId: string): CanonRightsProvenance {
  const status = clean(input.status || 'unverified',40) as CanonRightsProvenance['status'];
  const basis = clean(input.basis || 'unknown',40) as CanonRightsProvenance['basis'];
  if (!['approved','unverified','restricted','revoked'].includes(status)) throw new Error('Invalid rights status.');
  if (!['owned','licensed','consent','generated','public-domain','unknown'].includes(basis)) throw new Error('Invalid rights basis.');

  const expires = clean(input.expires_at,80) || null;
  if (expires && !Number.isFinite(Date.parse(expires))) throw new Error('Invalid rights expiry date.');

  return {
    rights_version: 'parable-rights-provenance-v1',
    status,
    basis,
    rights_holder: clean(input.rights_holder,260) || null,
    likeness_permission: input.likeness_permission === true,
    voice_permission: input.voice_permission === true,
    ai_generation_permission: input.ai_generation_permission === true,
    commercial_use: input.commercial_use === true,
    territories: (Array.isArray(input.territories) ? input.territories : [])
      .slice(0,40).map((item: unknown)=>clean(item,120)).filter(Boolean),
    expires_at: expires,
    evidence_note: clean(input.evidence_note,1200) || null,
    evidence_sha256: /^[a-f0-9]{64}$/i.test(clean(input.evidence_sha256,64))
      ? clean(input.evidence_sha256,64).toLowerCase()
      : null,
    declared_by_actor_id: actorId,
    declared_at: new Date().toISOString(),
    revoked_at: status === 'revoked' ? new Date().toISOString() : null,
    revoke_reason: status === 'revoked' ? clean(input.revoke_reason,800) || 'Marked revoked at upload.' : null
  };
}

export default async (request: Request) => {
  if (!['GET','POST'].includes(request.method)) return json({ error:'Method not allowed' },405);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = clean(url.searchParams.get('projectId'),96);
    const hash = clean(url.searchParams.get('id'),64).toLowerCase();
    if (!projectId || !safeId(projectId) || !/^[a-f0-9]{64}$/.test(hash)) {
      return json({ error:'A valid projectId and asset id are required.' },400);
    }

    try {
      await authorizeProject(request,projectId,'project:read');
      const meta = await readCanonAssetMetadata(projectId,hash);
      if (!meta) return json({ error:'Canon asset was not found.' },404);
      return json(meta);
    } catch (error) {
      const handled = securityErrorResponse(error);
      if (handled) return json(handled.body,handled.status);
      throw error;
    }
  }

  const body = await request.json().catch(()=>({})) as Record<string,any>;
  const action = clean(body.action || 'upload',40);
  const projectId = clean(body.projectId,96);
  if (!projectId || !safeId(projectId)) return json({ error:'A valid projectId is required.' },400);

  if (action === 'revoke') {
    const hash = clean(body.assetSha256,64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) return json({ error:'A valid assetSha256 is required.' },400);

    try {
      const access = await authorizeProject(request,projectId,'rights:approve');
      const updated = await revokeCanonAssetRights({
        projectId,
        hash,
        actorId: access.actor.actor_id,
        reason: clean(body.reason,800)
      });
      if (!updated) return json({ error:'Canon asset was not found.' },404);
      return json({
        asset: updated,
        render_effect: 'future renderer hydration will reject this asset immediately'
      });
    } catch (error) {
      const handled = securityErrorResponse(error);
      if (handled) return json(handled.body,handled.status);
      throw error;
    }
  }

  if (action !== 'upload') return json({ error:'Unsupported canon asset action.' },400);

  const base64 = String(body.base64 || '');
  const mediaType = clean(body.mediaType,120);
  const referenceKind = clean(body.referenceKind,80);
  const renderUsage = clean(body.renderUsage,80);
  if (!base64 || !mediaType || !referenceKind || !renderUsage) {
    return json({ error:'base64, mediaType, referenceKind and renderUsage are required.' },400);
  }
  if (base64.length > 12_000_000) {
    return json({
      error:'This upload is too large for the JSON upload lane.',
      code:'CANON_UPLOAD_TOO_LARGE',
      hint:'Use a smaller reference asset; resumable/direct object upload will be added for large production media.'
    },413);
  }

  const requestedRights = body.rights && typeof body.rights === 'object' ? body.rights : {};
  const requestedStatus = clean(requestedRights.status || 'unverified',40);
  const authAction = requestedStatus === 'approved' ? 'rights:approve' : 'project:edit';

  try {
    const access = await authorizeProject(request,projectId,authAction as any);
    const rights = normalizeRights(requestedRights,access.actor.actor_id);

    const validation = validateRightsForReference({ referenceKind, renderUsage, rights });
    if (rights.status === 'approved' && !validation.allowed) {
      return json({
        error:'Approved rights provenance is incomplete for this production use.',
        code:'RIGHTS_PROVENANCE_INCOMPLETE',
        blockers:validation.blockers
      },409);
    }

    const asset = await saveCanonAsset({
      projectId,
      base64,
      mediaType,
      originalName:clean(body.originalName,260) || null,
      sourceUrl:clean(body.sourceUrl,1800) || null,
      sourceTitle:clean(body.sourceTitle,260) || null,
      sourceCreator:clean(body.sourceCreator,260) || null,
      referenceKind,
      renderUsage,
      rights
    });

    return json({
      asset,
      logical_uri:'parable://canon/' + asset.sha256,
      preview_url:await signedCanonAssetUrl({
        projectId,
        hash:asset.sha256,
        purpose:'preview',
        ttlSeconds:900
      }),
      rights_validation:validation
    },201);
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body,handled.status);
    return json({
      error:error instanceof Error ? error.message : 'Canon asset upload failed.'
    },400);
  }
};

export const config = {
  path:'/api/canon-assets',
  rateLimit:{
    windowLimit:60,
    windowSize:60,
    aggregateBy:['ip','domain']
  }
};
