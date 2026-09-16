import superjson from 'superjson'
import { db } from '../helpers/db'
import type { OutputType } from './projects_GET.schema'

export async function handle() {
  try {
    const projects = await db
      .selectFrom('projects')
      .selectAll()
      .orderBy('updatedAt', 'desc')
      .execute()

    return new Response(superjson.stringify(projects satisfies OutputType))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load projects'
    return new Response(superjson.stringify({ error: message }), { status: 500 })
  }
}
