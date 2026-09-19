# PARABLE AI V8 provider and privacy contract

PARABLE keeps its story-to-screen intelligence provider-agnostic. Provider credentials live only in server-side Netlify Functions environment variables; they are never committed to GitHub or exposed to the browser.

## Two lanes, one non-negotiable boundary

PARABLE V8 separates real writer manuscripts from free-model experimentation.

### Protected manuscript lane

This is the default for every real project and every user-submitted manuscript.

OpenRouter calls request all of the following at once:

- native support for the requested structured-output parameters;
- provider fallback inside the privacy policy;
- `data_collection=deny`;
- `zdr=true` (Zero Data Retention routing);
- throughput-aware routing.

If no compatible provider endpoint is available, PARABLE does **not** relax the privacy policy to obtain an answer. It falls back to local deterministic processing and reports that fallback truthfully.

The protected lane is used by `/api/understand`, `/api/director-critic`, and the legacy `/api/adapt` path. The legacy adaptation route is deliberately prevented from bypassing the V8 privacy boundary.

### Synthetic benchmark lane

The benchmark lane exists only on Netlify Deploy Previews. It accepts three hard-coded PARABLE CI fixtures (`altar`, `yes`, `watchman`) through `/api/ai-benchmark`; arbitrary manuscript text cannot be supplied to this endpoint.

Because these are synthetic test stories rather than confidential writer manuscripts, the benchmark lane may use OpenRouter's dynamic `openrouter/free` router without the protected-manuscript ZDR/data-collection constraints. It still requires structured output support and applies PARABLE grounding/sanitization checks after generation.

Production never exposes this lane.

## Current staged intelligence

1. **Story Understanding V2** — premise, conflict, characters, themes, spiritual context, scenes, uncertainty and source grounding before screenplay/directing.
2. **Story Adaptation / Direction** — screenplay and shot-plan generation remains a separate stage; the legacy route now uses protected routing or local fallback.
3. **Film Quality Critic V3** — critiques story-to-screen choices, continuity, source fidelity, performance and cinematography. Critic suggestions are advisory and never auto-applied.
4. **Local deterministic fallback** — remains available when external providers fail or cannot satisfy privacy requirements.

## Grounding rules

Model-backed output is not accepted merely because it is valid JSON. PARABLE validates it before presenting it as model intelligence. Unsupported named characters are removed; unsupported Scripture references and claimed verbatim quotations are stripped or flagged; invalid shot references in critic suggestions are discarded; uncertainty remains explicit rather than being turned into certainty.

## Health and failover telemetry

`/api/ai-health` records provider/model name, stage, privacy lane, success/failure, latency and coarse error class. It never stores manuscript or prompt text. This lets PARABLE observe changing free-model reliability without creating a second copy of a writer's story in telemetry.

Tracked failure classes include timeout, rate-limit, privacy-policy mismatch, provider unavailability, schema failure, authentication failure and upstream 5xx errors.

## V8 acceptance gate

The automated Deploy Preview benchmark must demonstrate all of the following before V8 is considered complete:

- protected lane remains the default for user manuscripts;
- benchmark lane exists only for hard-coded synthetic fixtures on Deploy Preview;
- The Altar, Before I Said Yes and The Watchman receive real model-backed Story Understanding through the dynamic free router;
- the three stories do not collapse into one identical core-conflict interpretation;
- all three synthetic production packages receive a real model-backed Film Quality Critic pass;
- provider health records contain successful Story Understanding and Film Critic events;
- health telemetry contains no manuscript or prompt fields;
- provider/model failure never causes PARABLE to pretend a model ran when it actually used deterministic fallback.

`main` remains unchanged until the `immersive-v2` checkpoint is deliberately approved and merged.
