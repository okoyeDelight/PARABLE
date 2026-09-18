import {
  listProjectAudit,
  readProjectAccess,
  securityErrorResponse,
  updateProjectMember,
  authorizeProject
} from './_lib/security.mts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

const clean = (value: unknown, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeId = (value: string) => /^[a-zA-Z0-9_.:@-]{1,180}$/.test(value);

export default async (request: Request) => {
  if (!['GET','POST'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);

  const url = new URL(request.url);
  const projectId = clean(url.searchParams.get('projectId') || (request.method === 'POST' ? '' : ''), 96);

  if (request.method === 'GET') {
    const action = clean(url.searchParams.get('view') || 'members', 40);
    if (!projectId || !safeId(projectId)) return json({ error: 'A valid projectId is required.' }, 400);

    try {
      if (action === 'audit') {
        const rows = await listProjectAudit(
          request,
          projectId,
          Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 100) || 100))
        );
        return json({ project_id: projectId, audit: rows });
      }

      const context = await authorizeProject(request, projectId, 'members:manage');
      const access = await readProjectAccess(projectId);
      return json({
        project_id: projectId,
        workspace_id: access?.workspace_id || context.workspace_id,
        owner_actor_id: access?.owner_actor_id || null,
        members: access?.members || {}
      });
    } catch (error) {
      const handled = securityErrorResponse(error);
      if (handled) return json(handled.body, handled.status);
      throw error;
    }
  }

  const body = await request.json().catch(() => ({})) as Record<string, any>;
  const bodyProjectId = clean(body.projectId, 96);
  const targetActorId = clean(body.targetActorId, 180);
  const role = clean(body.role, 40) as any;
  const status = clean(body.status || 'active', 40) as any;

  if (!bodyProjectId || !safeId(bodyProjectId)) return json({ error: 'A valid projectId is required.' }, 400);
  if (!targetActorId || !safeId(targetActorId)) return json({ error: 'A valid targetActorId is required.' }, 400);
  if (!['owner','admin','editor','reviewer','viewer'].includes(role)) return json({ error: 'Invalid role.' }, 400);
  if (!['active','revoked'].includes(status)) return json({ error: 'Invalid membership status.' }, 400);

  try {
    const result = await updateProjectMember({
      request,
      projectId: bodyProjectId,
      targetActorId,
      role,
      status
    });
    return json(result.access, 200);
  } catch (error) {
    const handled = securityErrorResponse(error);
    if (handled) return json(handled.body, handled.status);
    throw error;
  }
};

export const config = {
  path: '/api/project-access',
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
