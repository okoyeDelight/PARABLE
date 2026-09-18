import { getDeployStore, getStore } from '@netlify/blobs';
import {
  acquireProjectMutation,
  abortProjectMutation,
  commitProjectMutation,
  projectMutationErrorResponse,
  type ProjectMutationLease
} from './_lib/project-concurrency.mts';
import {
  readAuthoritativeProjectState,
  stageProjectArtifact
} from './_lib/project-artifacts.mts';
import {
  buildVisualCanon,
  type RightsStatus,
  type VisualCanon
} from './_lib/render-foundation.mts';
import type { ContinuitySnapshot } from './_lib/continuity-core.mts';
import {
  readCanonAssetMetadata,
  validateRightsForReference
} from './_lib/canon-assets.mts';
import { authorizeProject, securityErrorResponse } from './_lib/security.mts';

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
    adaptations: make('parable-adaptations'),
    canon: make('parable-visual-canon')
  };
}

const clean = (value: unknown, max = 1200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_-]{1,96}$/.test(value);
const cleanList = (value: unknown, maxItems = 20, maxLength = 300) =>
  (Array.isArray(value) ? value : []).slice(0, maxItems).map((item) => clean(item, maxLength)).filter(Boolean);

function findReference(canon: VisualCanon, referenceId: string) {
  for (const entity of [...canon.characters, ...canon.locations, ...canon.props]) {
    const reference = entity.references.find((ref) => ref.id === referenceId);
    if (reference) return { entity, reference };
  }
  return null;
}

export default async (request: Request) => {
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  const s = stores();

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = clean(url.searchParams.get('projectId'), 96);
    if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);

    try {
      await authorizeProject(request, projectId, 'project:read');
    } catch (error) {
      const handled = securityErrorResponse(error);
      if (handled) return json(handled.body, handled.status);
      throw error;
    }

    const authoritative = await readAuthoritativeProjectState<VisualCanon>(projectId, 'visual-canon:latest');
    if (authoritative?.value) {
      return json({
        ...authoritative.value,
        project_revision: authoritative.revision,
        authoritative_ref: authoritative.ref
      });
    }

    const cached = await s.canon.get('project/' + projectId + '/latest', { type: 'json' }) as VisualCanon | null;
    if (!cached) return json({ error: 'Visual Canon has not been built for this project.' }, 404);
    return json(cached);
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const projectId = clean(body.projectId, 96);
  const action = clean(body.action || 'bootstrap', 40);

  if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);
  if (!['bootstrap', 'add_reference', 'approve_reference', 'update_style'].includes(action)) {
    return json({ error: 'Unsupported Visual Canon action.' }, 400);
  }

  try {
    await authorizeProject(
      request,
      projectId,
      action === 'approve_reference' ? 'rights:approve' : 'project:edit'
    );
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }

  let lease: ProjectMutationLease | null = null;
  try {
    lease = await acquireProjectMutation({
      projectId,
      mutationType: 'visual-canon:' + action,
      expectedRevision: Number.isFinite(Number(body.expectedProjectRevision))
        ? Number(body.expectedProjectRevision)
        : null,
      ttlMs: 30000
    });

    const [existingState, authoritativeAdaptation, cachedAdaptation, latestContinuity] = await Promise.all([
      readAuthoritativeProjectState<VisualCanon>(projectId, 'visual-canon:latest'),
      readAuthoritativeProjectState<Record<string, any>>(projectId, 'adaptation:latest'),
      s.adaptations.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<Record<string, any> | null>,
      s.continuity.get('project/' + projectId + '/latest', { type: 'json' }) as Promise<ContinuitySnapshot | null>
    ]);

    let adaptation = authoritativeAdaptation?.value || cachedAdaptation;
    const storyVersion = clean(
      body.storyVersion || adaptation?.story_version || existingState?.value?.story_version || latestContinuity?.story_version || 'story_unknown',
      96
    );

    if (adaptation?.story_version && adaptation.story_version !== storyVersion) {
      adaptation = await s.adaptations.get(
        'project/' + projectId + '/versions/' + storyVersion,
        { type: 'json' }
      ) as Record<string, any> | null;
    }

    const versionContinuity = await s.continuity.get(
      'project/' + projectId + '/versions/' + storyVersion + '/latest',
      { type: 'json' }
    ) as ContinuitySnapshot | null;

    const continuity = versionContinuity || (
      latestContinuity?.story_version === storyVersion ? latestContinuity : null
    );

    const existingCanon = existingState?.value?.story_version === storyVersion
      ? existingState.value
      : null;

    let canon = buildVisualCanon({
      projectId,
      storyVersion,
      productionBible: adaptation?.production_bible || null,
      continuity,
      existing: existingCanon
    });

    if (action === 'add_reference') {
      if (body.humanApproved !== true) {
        await abortProjectMutation(lease).catch(() => false);
        return json({ error: 'Adding Visual Canon references requires humanApproved: true.' }, 400);
      }

      const entityId = clean(body.entityId, 180);
      const entityName = clean(body.entityName, 180).toLowerCase();
      const referenceKind = clean(body.referenceKind, 80);
      const uri = clean(body.uri, 1800);
      const rightsStatus = clean(body.rightsStatus || 'unverified', 40) as RightsStatus;
      const assetSha256 = clean(body.assetSha256, 64).toLowerCase();
      const source = clean(body.source || 'human-upload', 40);
      const renderUsage = clean(body.renderUsage || (
        referenceKind === 'actor-face' || referenceKind === 'actor-visual'
          ? 'identity'
          : referenceKind === 'performance' || referenceKind === 'voice'
            ? 'performance'
            : referenceKind === 'wardrobe'
              ? 'wardrobe'
              : referenceKind.startsWith('location-')
                ? 'location'
                : referenceKind === 'prop-visual'
                  ? 'production-design'
                  : 'visual-style'
      ), 40);
      const origin = clean(body.origin || (
        source === 'human-upload' ? 'owned' :
        source === 'generated' ? 'generated' : 'unknown'
      ), 40);
      const validKinds = new Set([
        'actor-face','actor-visual','voice','wardrobe','performance',
        'location-visual','location-layout','location-lighting','prop-visual','style'
      ]);
      const validSources = new Set(['human-upload','generated','external']);
      const validRenderUsage = new Set([
        'identity','performance','wardrobe','location','production-design',
        'visual-style','inspiration-only','benchmark-only'
      ]);
      const validOrigins = new Set(['owned','licensed','generated','official-media','public-domain','unknown']);

      if (!validKinds.has(referenceKind) || !uri || !['approved','unverified','restricted','revoked'].includes(rightsStatus)) {
        await abortProjectMutation(lease).catch(() => false);
        return json({ error: 'referenceKind, uri and a valid rightsStatus are required.' }, 400);
      }
      if (!validSources.has(source)) {
        await abortProjectMutation(lease).catch(() => false);
        return json({ error: 'source must be human-upload, generated or external.' }, 400);
      }
      if (!validRenderUsage.has(renderUsage) || !validOrigins.has(origin)) {
        await abortProjectMutation(lease).catch(() => false);
        return json({ error: 'Invalid renderUsage or origin.' }, 400);
      }
      if (
        renderUsage === 'identity' &&
        (source === 'external' || origin === 'official-media') &&
        rightsStatus !== 'approved'
      ) {
        await abortProjectMutation(lease).catch(() => false);
        return json({
          error: 'External/official actor likeness references can only enter identity rendering after rights are explicitly approved. Use inspiration-only until permission is secured.',
          code: 'LIKENESS_RIGHTS_REQUIRED'
        }, 409);
      }

      const inspirationOnly = renderUsage === 'inspiration-only' || renderUsage === 'benchmark-only';
      let vaultAsset = null as Awaited<ReturnType<typeof readCanonAssetMetadata>>;

      if (assetSha256) {
        if (!/^[a-f0-9]{64}$/.test(assetSha256)) {
          await abortProjectMutation(lease).catch(() => false);
          return json({ error: 'assetSha256 must be a 64-character SHA-256 digest.' }, 400);
        }
        vaultAsset = await readCanonAssetMetadata(projectId, assetSha256);
        if (!vaultAsset) {
          await abortProjectMutation(lease).catch(() => false);
          return json({
            error: 'The immutable canon asset was not found in this project vault.',
            code: 'CANON_ASSET_NOT_FOUND'
          }, 404);
        }
        if (vaultAsset.reference_kind !== referenceKind || vaultAsset.render_usage !== renderUsage) {
          await abortProjectMutation(lease).catch(() => false);
          return json({
            error: 'The vault asset was registered for a different reference kind or render usage.',
            code: 'CANON_ASSET_USAGE_MISMATCH'
          }, 409);
        }
      }

      if (!inspirationOnly && rightsStatus === 'approved') {
        if (!vaultAsset) {
          await abortProjectMutation(lease).catch(() => false);
          return json({
            error: 'Approved production references must point to an immutable vaulted asset.',
            code: 'CANON_VAULT_REQUIRED'
          }, 409);
        }
        const rightsValidation = validateRightsForReference({
          referenceKind,
          renderUsage,
          rights: vaultAsset.rights
        });
        if (!rightsValidation.allowed) {
          await abortProjectMutation(lease).catch(() => false);
          return json({
            error: 'Vaulted rights provenance does not permit this production use.',
            code: 'RIGHTS_PROVENANCE_INCOMPLETE',
            blockers: rightsValidation.blockers
          }, 409);
        }
      }

      const entities = [...canon.characters, ...canon.locations, ...canon.props];
      const entity = entities.find((item) =>
        (entityId && item.id === entityId) ||
        (entityName && item.name.toLowerCase() === entityName)
      );
      if (!entity) {
        await abortProjectMutation(lease).catch(() => false);
        return json({ error: 'The target entity was not found in the Visual Canon.' }, 404);
      }

      const logicalUri = vaultAsset ? ('parable://canon/' + vaultAsset.sha256) : uri;
      const duplicate = entity.references.find((ref) =>
        (assetSha256 && ref.asset_sha256 === assetSha256) ||
        (ref.kind === referenceKind && ref.uri === logicalUri)
      );
      if (!duplicate) {
        entity.references.push({
          id: 'ref_' + entity.id + '_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16),
          kind: referenceKind as any,
          uri: logicalUri,
          label: clean(body.label, 220) || (entity.name + ' · ' + referenceKind.replaceAll('-', ' ')),
          rights_status: vaultAsset?.rights.status || rightsStatus,
          approved_by_human: true,
          source: source as any,
          render_usage: renderUsage as any,
          origin: origin as any,
          source_title: clean(body.sourceTitle, 260) || vaultAsset?.source_title || undefined,
          source_creator: clean(body.sourceCreator, 260) || vaultAsset?.source_creator || undefined,
          source_url: clean(body.sourceUrl, 1800) || vaultAsset?.source_url || undefined,
          asset_sha256: vaultAsset?.sha256,
          immutable_asset_uri: vaultAsset ? ('parable://canon/' + vaultAsset.sha256) : undefined,
          rights_provenance: vaultAsset?.rights ? {
            status: vaultAsset.rights.status,
            basis: vaultAsset.rights.basis,
            rights_holder: vaultAsset.rights.rights_holder,
            likeness_permission: vaultAsset.rights.likeness_permission,
            voice_permission: vaultAsset.rights.voice_permission,
            ai_generation_permission: vaultAsset.rights.ai_generation_permission,
            commercial_use: vaultAsset.rights.commercial_use,
            territories: vaultAsset.rights.territories,
            expires_at: vaultAsset.rights.expires_at,
            evidence_sha256: vaultAsset.rights.evidence_sha256,
            declared_by_actor_id: vaultAsset.rights.declared_by_actor_id,
            declared_at: vaultAsset.rights.declared_at,
            revoked_at: vaultAsset.rights.revoked_at
          } : undefined,
          notes: clean(body.notes, 500) || undefined
        });
      } else {
        duplicate.rights_status = vaultAsset?.rights.status || rightsStatus;
        duplicate.approved_by_human = true;
        duplicate.render_usage = renderUsage as any;
        duplicate.asset_sha256 = vaultAsset?.sha256 || duplicate.asset_sha256;
        duplicate.immutable_asset_uri = vaultAsset ? ('parable://canon/' + vaultAsset.sha256) : duplicate.immutable_asset_uri;
        duplicate.rights_provenance = vaultAsset?.rights ? {
          status: vaultAsset.rights.status,
          basis: vaultAsset.rights.basis,
          rights_holder: vaultAsset.rights.rights_holder,
          likeness_permission: vaultAsset.rights.likeness_permission,
          voice_permission: vaultAsset.rights.voice_permission,
          ai_generation_permission: vaultAsset.rights.ai_generation_permission,
          commercial_use: vaultAsset.rights.commercial_use,
          territories: vaultAsset.rights.territories,
          expires_at: vaultAsset.rights.expires_at,
          evidence_sha256: vaultAsset.rights.evidence_sha256,
          declared_by_actor_id: vaultAsset.rights.declared_by_actor_id,
          declared_at: vaultAsset.rights.declared_at,
          revoked_at: vaultAsset.rights.revoked_at
        } : duplicate.rights_provenance;
        duplicate.origin = origin as any;
        duplicate.source_title = clean(body.sourceTitle, 260) || duplicate.source_title;
        duplicate.source_creator = clean(body.sourceCreator, 260) || duplicate.source_creator;
        duplicate.source_url = clean(body.sourceUrl, 1800) || duplicate.source_url;
        duplicate.notes = clean(body.notes, 500) || duplicate.notes;
      }
      canon.updated_at = new Date().toISOString();
    }

    if (action === 'approve_reference') {
      if (body.humanApproved !== true) {
        await abortProjectMutation(lease).catch(() => false);
        return json({ error: 'Reference-rights changes require humanApproved: true.' }, 400);
      }

      const referenceId = clean(body.referenceId, 240);
      const rightsStatus = clean(body.rightsStatus, 40) as RightsStatus;
      if (!referenceId || !['approved', 'unverified', 'restricted', 'revoked'].includes(rightsStatus)) {
        await abortProjectMutation(lease).catch(() => false);
        return json({ error: 'A valid referenceId and rightsStatus are required.' }, 400);
      }

      const found = findReference(canon, referenceId);
      if (!found) {
        await abortProjectMutation(lease).catch(() => false);
        return json({ error: 'Reference was not found in the current Visual Canon.' }, 404);
      }

      if (
        rightsStatus === 'approved' &&
        found.reference.render_usage !== 'inspiration-only' &&
        found.reference.render_usage !== 'benchmark-only'
      ) {
        const hash = clean(found.reference.asset_sha256, 64).toLowerCase();
        const vaultAsset = hash ? await readCanonAssetMetadata(projectId, hash) : null;
        if (!vaultAsset) {
          await abortProjectMutation(lease).catch(() => false);
          return json({
            error: 'Production references cannot be approved until the exact bytes are stored in the immutable canon vault.',
            code: 'CANON_VAULT_REQUIRED'
          }, 409);
        }
        const validation = validateRightsForReference({
          referenceKind: found.reference.kind,
          renderUsage: String(found.reference.render_usage || ''),
          rights: vaultAsset.rights
        });
        if (!validation.allowed) {
          await abortProjectMutation(lease).catch(() => false);
          return json({
            error: 'Vaulted rights provenance does not authorize this reference.',
            code: 'RIGHTS_PROVENANCE_INCOMPLETE',
            blockers: validation.blockers
          }, 409);
        }
        found.reference.rights_provenance = {
          status: vaultAsset.rights.status,
          basis: vaultAsset.rights.basis,
          rights_holder: vaultAsset.rights.rights_holder,
          likeness_permission: vaultAsset.rights.likeness_permission,
          voice_permission: vaultAsset.rights.voice_permission,
          ai_generation_permission: vaultAsset.rights.ai_generation_permission,
          commercial_use: vaultAsset.rights.commercial_use,
          territories: vaultAsset.rights.territories,
          expires_at: vaultAsset.rights.expires_at,
          evidence_sha256: vaultAsset.rights.evidence_sha256,
          declared_by_actor_id: vaultAsset.rights.declared_by_actor_id,
          declared_at: vaultAsset.rights.declared_at,
          revoked_at: vaultAsset.rights.revoked_at
        };
      }

      found.reference.rights_status = rightsStatus;
      found.reference.approved_by_human = true;
      found.reference.notes = clean(body.notes, 500) || found.reference.notes;
      canon.updated_at = new Date().toISOString();
    }

    if (action === 'update_style') {
      if (body.humanApproved !== true) {
        await abortProjectMutation(lease).catch(() => false);
        return json({ error: 'Visual style changes require humanApproved: true.' }, 400);
      }

      const patch = body.style && typeof body.style === 'object' ? body.style : {};
      canon.style = {
        visual_language: cleanList(patch.visual_language ?? canon.style.visual_language),
        forbidden_shortcuts: cleanList(patch.forbidden_shortcuts ?? canon.style.forbidden_shortcuts),
        color_notes: cleanList(patch.color_notes ?? canon.style.color_notes),
        texture_notes: cleanList(patch.texture_notes ?? canon.style.texture_notes),
        cultural_notes: cleanList(patch.cultural_notes ?? canon.style.cultural_notes)
      };

      const policy = body.compositionPolicy && typeof body.compositionPolicy === 'object'
        ? body.compositionPolicy
        : {};
      if (policy.default_intensity !== undefined) {
        canon.composition_policy.default_intensity = Math.max(0, Math.min(1, Number(policy.default_intensity) || 0.35));
      }
      if (policy.safe_for_vertical_crop !== undefined) {
        canon.composition_policy.safe_for_vertical_crop = Boolean(policy.safe_for_vertical_crop);
      }
      canon.updated_at = new Date().toISOString();
    }

    canon.unresolved_rights = [...canon.characters, ...canon.locations, ...canon.props].flatMap((entity) =>
      entity.references
        .filter((ref) => {
          if (ref.render_usage === 'inspiration-only' || ref.render_usage === 'benchmark-only') {
            return ref.rights_status === 'revoked';
          }
          return (
            ref.rights_status !== 'approved' ||
            !ref.asset_sha256 ||
            !ref.rights_provenance ||
            ref.rights_provenance.status !== 'approved' ||
            !ref.rights_provenance.ai_generation_permission ||
            Boolean(ref.rights_provenance.expires_at && Date.parse(ref.rights_provenance.expires_at) <= Date.now())
          );
        })
        .map((ref) => ({
          entity_id: entity.id,
          reference_id: ref.id,
          reason: ref.rights_status === 'revoked'
            ? 'Reference rights have been revoked and this asset must not be used for new renders.'
            : !ref.asset_sha256
              ? 'Production reference bytes are not yet stored in the immutable canon vault.'
              : ref.rights_status === 'restricted'
                ? 'Reference has usage restrictions that require human review before final rendering.'
                : 'Reference rights provenance is incomplete, expired or unverified.'
        }))
    );

    const ref = await stageProjectArtifact({
      projectId,
      mutationId: lease.mutation_id,
      kind: 'visual-canon',
      artifactId: storyVersion,
      value: canon
    });

    const committed = await commitProjectMutation(
      lease,
      {
        story_version: storyVersion,
        action,
        character_count: canon.characters.length,
        location_count: canon.locations.length,
        prop_count: canon.props.length,
        unresolved_rights: canon.unresolved_rights.length
      },
      { 'visual-canon:latest': ref }
    );

    await s.canon.setJSON('project/' + projectId + '/latest', {
      ...canon,
      project_revision: committed.revision,
      authoritative_ref: ref
    }).catch(() => {});

    return json({
      ...canon,
      project_revision: committed.revision,
      mutation_id: committed.mutation_id,
      authoritative_ref: ref
    }, 201);
  } catch (error) {
    if (lease) await abortProjectMutation(lease).catch(() => false);
    const handled = projectMutationErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }
};

export const config = {
  path: '/api/visual-canon',
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
