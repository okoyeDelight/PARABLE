# PARABLE Story Intelligence provider contract

PARABLE keeps the story-to-screen pipeline provider-agnostic. External model credentials are supplied only to Netlify Functions through environment variables; they are never committed to GitHub or exposed to the browser.

## Deploy Preview configuration

- `PARABLE_AI_PROVIDER=auto`
- `PARABLE_AI_ORDER=gemini,groq`
- `PARABLE_GEMINI_MODEL=gemini-3.8-flash`
- `PARABLE_GEMINI_THINKING=high`
- `PARABLE_GROQ_MODEL=openai/gpt-oss-120b`
- `PARABLE_GROQ_REASONING=high`

Secrets are intentionally absent from source control:

- `GEMINI_API_KEY`
- `GROQ_API_KEY`

With no provider secret configured, `/api/adapt` must fall back truthfully to the local deterministic Story Intelligence engine instead of pretending a model ran.

## Activation rules

1. Prefer Gemini in automatic mode, then fail over to Groq.
2. Gemini calls use the Interactions API with `store:false` and structured JSON output.
3. Groq calls use strict JSON-schema output.
4. Model responses pass through server-side grounding guards before they can reach the Studio UI.
5. Unsupported character names are removed, unsupported screenplay speaker names are replaced with a generic role, and unsupported Scripture references or claimed verbatim quotations are stripped/flagged for human review.
6. Provider failures, timeouts, schema failures, rate limits, or grounding failures fall through to the next provider and finally to the deterministic engine.
7. Production remains unchanged until the `immersive-v2` work is deliberately merged to `main`.

## Acceptance gate before merge

Run the Golden Flow against at least three distinct genres. A real provider run must prove source fidelity, distinct story/shot plans, manuscript versioning, directing persistence, no invented named characters, no invented Scripture references or quotations, and a visible truthful provider state in the Studio.
