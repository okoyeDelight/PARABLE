import { getStore } from '@netlify/blobs';
import { getContext } from '@netlify/functions';

function runtimeScope() {
  let context: any = null;
  try { context = getContext(); } catch {}
  const deployContext = context?.deploy?.context || Netlify.context?.deploy?.context || 'unknown';
  if (deployContext === 'production') return { production: true, prefix: '' };

  const deployId = String(context?.deploy?.id || Netlify.context?.deploy?.id || 'local')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 96);

  return { production: false, prefix: 'deploy/' + (deployId || 'local') + '/' };
}

function artifactStore() {
  const scope = runtimeScope();
  return {
    scope,
    store: getStore(scope.production ? 'parable-project-artifacts' : 'parable-project-artifacts-sandbox', {
      consistency: 'strong'
    })
  };
}

const safe = (value: string) => String(value || '')
  .replace(/[^a-zA-Z0-9_.:-]/g, '_')
  .slice(0, 140);

export async function stageProjectArtifact(args: {
  projectId: string;
  mutationId: string;
  kind: string;
  artifactId?: string | null;
  value: unknown;
}) {
  const { scope, store } = artifactStore();
  const projectId = safe(args.projectId);
  const mutationId = safe(args.mutationId);
  const kind = safe(args.kind);
  const artifactId = safe(args.artifactId || 'latest');

  const ref = [
    scope.prefix + 'project',
    projectId,
    'mutations',
    mutationId,
    kind,
    artifactId
  ].join('/');

  await store.setJSON(ref, {
    version: 'parable-project-artifact-v1',
    project_id: projectId,
    mutation_id: mutationId,
    kind,
    artifact_id: artifactId,
    value: args.value,
    staged_at: new Date().toISOString()
  }, { onlyIfNew: true } as any);

  return ref;
}

export async function readProjectArtifact<T = unknown>(ref: string): Promise<T | null> {
  if (!ref || ref.length > 800) return null;
  const { store } = artifactStore();
  const envelope = await store.get(ref, { type: 'json' }) as {
    value?: T;
  } | null;
  return envelope?.value ?? null;
}
