import { Kysely, CamelCasePlugin } from 'kysely'
import { PostgresJSDialect } from 'kysely-postgres-js'
import { DB, kyselyIdentifierOverrides } from './schema'
import postgres from 'postgres'

class FlootCamelCasePlugin extends CamelCasePlugin {
  protected override snakeCase(str: string): string {
    return kyselyIdentifierOverrides[str] ?? super.snakeCase(str)
  }
}

export const db = new Kysely<DB>({
  plugins: [new FlootCamelCasePlugin()],
  dialect: new PostgresJSDialect({
    postgres: postgres(process.env.FLOOT_DATABASE_URL, {
      prepare: false,
      idle_timeout: 10,
      max: 3,
    }),
  }),
})
