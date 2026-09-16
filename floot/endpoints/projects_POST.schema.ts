import { z } from 'zod'
import superjson from 'superjson'
import type { Selectable } from 'kysely'
import type { Projects } from '../helpers/schema'

export const schema = z.object({
  title: z.string().trim().min(1).max(200),
  sourceText: z.string().max(200000).optional().default(''),
  setting: z.string().trim().max(300).optional().default(''),
  primaryAudience: z.string().trim().max(300).optional().default(''),
  audienceScope: z.enum(['global', 'regional', 'local']).default('global'),
  storyPeriod: z.enum(['present', 'historical', 'future']).default('present'),
})

export type InputType = z.infer<typeof schema>
export type OutputType = Selectable<Projects>

export async function postProjects(body: InputType, init?: RequestInit): Promise<OutputType> {
  const validatedInput = schema.parse(body)
  const result = await fetch('/_api/projects', {
    method: 'POST',
    body: superjson.stringify(validatedInput),
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text())
    throw new Error(errorObject.error)
  }
  return superjson.parse<OutputType>(await result.text())
}
