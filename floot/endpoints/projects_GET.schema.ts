import superjson from 'superjson'
import type { Selectable } from 'kysely'
import type { Projects } from '../helpers/schema'

export type OutputType = Selectable<Projects>[]

export async function getProjects(init?: RequestInit): Promise<OutputType> {
  const result = await fetch('/_api/projects', { method: 'GET', ...init })
  if (!result.ok) {
    const body = superjson.parse<{ error: string }>(await result.text())
    throw new Error(body.error)
  }
  return superjson.parse<OutputType>(await result.text())
}
