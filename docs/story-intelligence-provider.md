# PARABLE Story Intelligence provider contract

PARABLE keeps the story-to-screen pipeline provider-agnostic. External model credentials are supplied only to Netlify Functions through environment variables; they are never committed to GitHub or exposed to the browser.

## Deploy Preview configuration

- `PARABLE_AI_PROVIDER=auto`
- `PARABLE_AI_ORDER=openrouter,groq,gemini`
- `PARABLE_OPENROUTER_MODEL=nex-agi/nex-n2.5-mini:free`
- `PARABLE_GROQ_MODEL=openai/gpt-oss-120b`
- `PARABLE_GROQ_REASONING=high`
- `PARABLE_GEMINI_MODEL=gemini-3.8-flash`
- `PARABLE_GEMINI_THINKING=high`

Secrets are intentionally absent from source control:

- `OPENROUTER_API_KEY`
- `GROQ_API_KEY`
- `GEMINI_API_KEY`

With no provider secret configured, `/api/adapt` must fall back truthfully to the local deterministic Story Intelligence engine instead of pretending a model ran.

## Activation rules

1. Prefer OpenRouter in automatic mode, then fail over to Groq, then Gemini.
2. During the free development checkpoint, use a named free OpenRouter model that explicitly advertises JSON-schema structured outputs rather than the random free router. This avoids a routing conflict observed when `openrouter/free` was combined with strict parameter and data-policy filters.
3. OpenRouter requests use strict structured JSON-schema output and `provider.data_collection=deny`; this prevents routing to providers that train on request data, but it is not a zero-retention guarantee.
4. Gemini calls use the Interactions API with `store:false` and structured JSON output.
5. Groq calls use strict JSON-schema output.
6. Model responses pass through server-side grounding guards before they can reach the Studio UI.
7. Unsupported character names are removed, unsupported screenplay speaker names are replaced with a generic role, and unsupported Scripture references or claimed verbatim quotations are stripped/flagged for human review.
8. Provider failures, timeouts, schema failures, rate limits, or grounding failures fall through to the next provider and finally to the deterministic engine.
9. Production remains unchanged until the `immersive-v2` work is deliberately merged to `main`.

## Current activation checkpoint

The Deploy Preview has an `OPENROUTER_API_KEY` configured as a secret environment variable. The focused provider probe proved the secret is visible to server functions and not to the client. Its first run exposed a routing conflict. Netlify environment inspection now confirms the Deploy Preview override is actually set to `nex-agi/nex-n2.5-mini:free`, while production still has no OpenRouter secret. This commit exists to force a clean preview rebuild with that corrected environment snapshot before rerunning the probe.

## Acceptance gate before merge

Run the Golden Flow against at least three distinct genres. A real provider run must prove source fidelity, distinct story/shot plans, manuscript versioning, directing persistence, no invented named characters, no invented Scripture references or quotations, and a visible truthful provider state in the Studio.
