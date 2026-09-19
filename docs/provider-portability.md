# PARABLE provider portability and scale ceiling strategy

PARABLE must never be architected so that one hosting provider, one AI vendor, one queue implementation or one database product becomes the permanent ceiling of the product.

There is no genuinely unlimited cloud platform. Every provider has physical capacity, quotas, billing rules and failure modes. PARABLE's objective is therefore **horizontal portability**, not the fiction of unlimited infrastructure.

## Current provider boundaries

### Web / Functions

Netlify currently hosts the web application and stateless API tier.

Application logic should remain stateless wherever possible so it can be moved behind another serverless or container runtime later without changing the film-production data model.

### Durable jobs

PARABLE now uses a queue abstraction.

Current dispatch chain:

1. Netlify Async Workloads when enabled and healthy.
2. Netlify Background Functions as an automatic claim-check fallback.
3. Idempotent client retries reuse the same durable job instead of duplicating AI work.

The job payload itself is stored outside the queue. Queue messages contain only lightweight identifiers. This keeps the transport replaceable.

Future queue adapters may include a dedicated external queue or event bus without changing Studio or production engines.

### Hot transactional state

Netlify Blobs remains useful for:

- immutable snapshots;
- job payload claim checks;
- job results;
- reference assets;
- append-only telemetry;
- archives.

Blobs must not become the permanent transaction engine for simultaneous editing of the same project.

The prepared PostgreSQL schemas under `database/` define the intended hot-state layer for:

- project revisions;
- continuity events;
- optimistic concurrency;
- idempotency;
- workspace membership;
- project ownership;
- access audit;
- durable job metadata.

The schema is PostgreSQL rather than vendor-specific SQL so PARABLE can run it on Netlify Database, Supabase, Neon, RDS-compatible Postgres or another production Postgres provider.

### AI inference

AI routing is provider-agnostic by design.

The production contract is owned by PARABLE, not by a model vendor. A provider/model can be replaced as long as it satisfies:

- required output schema;
- privacy policy;
- latency / availability target;
- quality benchmark.

No renderer or reasoning provider should become the canonical source of project truth.

## Scaling rule

A new engine must be classified before implementation:

- CDN/static asset;
- stateless synchronous request;
- durable asynchronous job;
- immutable object/snapshot;
- transactional mutation;
- streaming/realtime session.

If an operation is expensive, retryable or provider-dependent, it should not sit directly on a fragile request/response path.

If an operation can be mutated concurrently by multiple people, it belongs in the transactional state tier.

## Traffic tiers

The initial engineering gate is 1,000 simultaneously active users.

Beyond that, scale should happen by adding capacity or providers rather than rewriting the application:

- stateless API replicas scale horizontally;
- long jobs remain queued;
- read-heavy immutable data can be CDN/cache served;
- transactional writes move to horizontally scalable Postgres infrastructure;
- rendering/inference can be split across worker pools/providers;
- object/video assets can move to dedicated object storage/CDN.

## Failure policy

PARABLE should degrade gracefully rather than corrupt state.

Examples:

- queue provider unavailable -> alternate queue backend;
- AI provider unavailable -> retry/failover/local conservative path;
- browser disconnect -> job continues and can be resumed;
- duplicate submit -> same idempotent job;
- telemetry unavailable -> creative work continues;
- transactional conflict -> reject/rebase rather than overwrite;
- renderer unavailable -> production state remains intact for later rendering.

## Cost and quota boundary

Architecture can remove a single-provider ceiling, but it cannot remove the physical cost of compute, bandwidth, storage and inference.

The system must therefore expose usage and capacity signals early enough to scale infrastructure deliberately instead of failing unexpectedly.

The target is not "no limits exist."

The target is:

**No hidden architectural limit should force PARABLE to be rewritten when usage grows.**
