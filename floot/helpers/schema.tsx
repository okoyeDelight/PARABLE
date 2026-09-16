import type { ColumnType } from 'kysely'

export type AudienceScope = 'global' | 'local' | 'regional'
export type ContextStatus = 'planned' | 'ready' | 'researching' | 'stale'
export type ContextType = 'audience' | 'culture' | 'location' | 'organization' | 'time'
export type EngineStatus = 'active' | 'foundation' | 'mapped' | 'paused'
export type EngineType = 'audio' | 'culture' | 'film' | 'learning' | 'location' | 'render' | 'story'
export type ProjectStatus = 'complete' | 'draft' | 'episode_plan' | 'production' | 'story_bible'
export type StoryPeriod = 'future' | 'historical' | 'present'

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>

export type Int8 = ColumnType<string, bigint | number | string, bigint | number | string>
export type Json = JsonValue
export type JsonArray = JsonValue[]
export type JsonObject = { [x: string]: JsonValue | undefined }
export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonArray | JsonObject | JsonPrimitive
export type Timestamp = ColumnType<Date, Date | string, Date | string>

export interface EngineModules {
  capabilities: Generated<Json>
  displayName: string
  engineKey: string
  engineType: EngineType
  implementationNotes: string | null
  status: Generated<EngineStatus>
  updatedAt: Generated<Timestamp>
  version: Generated<string>
}

export interface ProjectContexts {
  config: Generated<Json>
  contextType: ContextType
  createdAt: Generated<Timestamp>
  id: Generated<Int8>
  label: string
  lastRefreshedAt: Timestamp | null
  projectId: string
  scopeValue: string | null
  sourceSummary: Generated<Json>
  status: Generated<ContextStatus>
  updatedAt: Generated<Timestamp>
}

export interface Projects {
  audienceScope: Generated<AudienceScope>
  createdAt: Generated<Timestamp>
  id: string
  logline: string | null
  primaryAudience: string | null
  progress: Generated<number>
  setting: string | null
  sourceText: string | null
  status: Generated<ProjectStatus>
  storyPeriod: Generated<StoryPeriod>
  title: string
  updatedAt: Generated<Timestamp>
}

export interface DB {
  engineModules: EngineModules
  projectContexts: ProjectContexts
  projects: Projects
}

export const ProjectStatusArrayValues: [ProjectStatus, ...ProjectStatus[]] = ['complete','draft','episode_plan','production','story_bible']
export const AudienceScopeArrayValues: [AudienceScope, ...AudienceScope[]] = ['global','local','regional']
export const StoryPeriodArrayValues: [StoryPeriod, ...StoryPeriod[]] = ['future','historical','present']
export const ContextTypeArrayValues: [ContextType, ...ContextType[]] = ['audience','culture','location','organization','time']
export const ContextStatusArrayValues: [ContextStatus, ...ContextStatus[]] = ['planned','ready','researching','stale']
export const EngineTypeArrayValues: [EngineType, ...EngineType[]] = ['audio','culture','film','learning','location','render','story']
export const EngineStatusArrayValues: [EngineStatus, ...EngineStatus[]] = ['active','foundation','mapped','paused']
export const kyselyIdentifierOverrides: Record<string, string> = {}
