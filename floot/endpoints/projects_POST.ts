import { nanoid } from 'nanoid'
import superjson from 'superjson'
import { db } from '../helpers/db'
import { schema, type OutputType } from './projects_POST.schema'

export async function handle(request: Request) {
  try {
    const parsed = schema.parse(superjson.parse(await request.text()))
    const now = new Date()
    const id = `proj_${nanoid(12)}`
    const logline = parsed.sourceText.trim().slice(0, 150) || 'New story waiting for its first creative analysis.'

    const project = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('projects')
        .values({
          id,
          title: parsed.title,
          sourceText: parsed.sourceText || null,
          logline,
          setting: parsed.setting || null,
          primaryAudience: parsed.primaryAudience || null,
          audienceScope: parsed.audienceScope,
          storyPeriod: parsed.storyPeriod,
          status: 'draft',
          progress: 5,
          createdAt: now,
          updatedAt: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const contexts = [
        { contextType: 'audience' as const, label: 'Primary audience', scopeValue: parsed.primaryAudience || parsed.audienceScope },
        { contextType: 'time' as const, label: 'Story period', scopeValue: parsed.storyPeriod },
        ...(parsed.setting ? [{ contextType: 'location' as const, label: 'Story setting', scopeValue: parsed.setting }] : []),
      ]

      if (contexts.length) {
        await trx.insertInto('projectContexts').values(
          contexts.map((context) => ({
            projectId: id,
            ...context,
            status: 'planned' as const,
            config: {},
            sourceSummary: [],
            createdAt: now,
            updatedAt: now,
          })),
        ).execute()
      }

      return created
    })

    return new Response(superjson.stringify(project satisfies OutputType), { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create project'
    return new Response(superjson.stringify({ error: message }), { status: 400 })
  }
}
