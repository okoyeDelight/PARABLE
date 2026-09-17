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
4. Gemini and Groq remain provider-level fallbacks. The Story Intelligence endpoint must never report `mode=model` unless a provider actually returned and passed the grounding guards.
5. Model responses pass through server-side grounding guards before they can reach the Studio UI.
6. Unsupported character names are removed, unsupported screenplay speaker names are replaced with a generic role, and unsupported Scripture references or claimed verbatim quotations are stripped/flagged for human review.
7. Provider failures, timeouts, schema failures, rate limits, or grounding failures fall through to the next provider and finally to the deterministic engine.
8. Production remains unchanged until the `immersive-v2` work is deliberately merged to `main`.

## Reliability checkpoint

The Deploy Preview has an `OPENROUTER_API_KEY` configured as a secret environment variable and production still has no OpenRouter secret. The first real-model checkpoint succeeded with `nex-agi/nex-n2.5-mini:free`.

A later experiment switched the preview to `dots-studio/dots-3-note-preview:free` because its public availability looked stronger. The deployed probe confirmed the Dots override was active, but the Story Intelligence request returned a 502 before a valid structured response arrived. A rerun was therefore used to distinguish a transient outage from a systematic synchronous-latency problem. Until Dots proves it can complete this full structured Story Intelligence workload inside the deployed request budget, PARABLE keeps Nex as the synchronous free primary rather than claiming Dots is production-ready.

Dots remains a candidate for slower asynchronous critic/review work, where a longer-running job can tolerate its latency without blocking the writer experience.

## Acceptance gate before merge

Run the Golden Flow against at least three distinct genres. A real provider run must prove source fidelity, distinct story/shot plans, manuscript versioning, directing persistence, no invented named characters, no invented Scripture references or quotations, and a visible truthful provider state in the Studio.
