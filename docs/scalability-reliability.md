# PARABLE scale, reliability and concurrency foundation

## Capacity target

PARABLE is being engineered for at least **1,000 simultaneous active users** as an initial production target. This is a design target, not a guarantee until the exact production plan, AI-provider quotas and a representative 1,000-user load test pass together.

The architecture separates cheap synchronous reads from expensive AI work so traffic spikes do not force every user request to hold an open serverless function while waiting on a model.

## Current scale architecture

### 1. Stateless web/API layer

Netlify Functions remain stateless. Horizontal scaling is therefore handled by the platform instead of a single long-running application server.

### 2. Durable asynchronous AI work

Heavy continuity operations can be submitted through:

`POST /api/jobs`

Supported durable jobs currently include:

- `scene-state`
- `shot-state`

The public endpoint stores the full request using a claim-check pattern and sends only a tiny job reference into Netlify Async Workloads.

This prevents large story payloads from being copied through the queue and gives PARABLE:

- durable execution;
- execution leases to collapse duplicate queue deliveries before an expensive AI call;
- retry with exponential backoff;
- dead-letter handling through Netlify Async Workloads;
- fast 202 responses to clients;
- load decoupling between user traffic and AI-provider latency.

Job status is read through the dedicated high-volume polling path:

`GET /api/job-status?id=job_xxx`

The status endpoint returns an adaptive `poll_after_ms` hint. Submission and polling use separate rate-limit envelopes so a large population waiting for jobs does not consume the mutation budget.

The endpoint supports idempotency through the standard `Idempotency-Key` request header. Repeated submissions with the same key and same payload resolve to the same durable job instead of paying for duplicate AI work.

Reusing the same idempotency key with a different payload returns a conflict.

### 3. Sequential shot continuity

Shots inside a scene are intentionally processed in order.

This is not an artificial limitation. Shot N+1 needs the physical state left by Shot N. The durable worker retries a shot that arrives before its predecessor rather than fabricating missing world state.

Different projects and different users can still execute concurrently.

### 4. Append-only high-volume telemetry

Both AI-provider health and durable-job lifecycle telemetry use time-sharded append-only event keys. No manuscript, prompt, or job payload text is copied into operational telemetry.

Queue health can therefore be derived without many workers contending on one shared counter blob.



AI health telemetry no longer updates one shared aggregate blob on every request.

Each provider event is written to a unique sharded key. Health aggregates are derived from recent immutable events when read.

This removes a hot shared write key that would otherwise suffer lost updates under burst traffic.

### 5. Strong-consistency production reads

Mutable production Blob stores use strong consistency. Deploy previews continue using deploy-scoped stores so test traffic cannot alter production state.

### 6. Privacy boundary survives scale

Real manuscript data continues to use the protected provider lane. Scaling traffic never relaxes Zero Data Retention / data-collection requirements merely to obtain capacity.

If compliant inference is unavailable, PARABLE degrades to local conservative processing or a durable retry instead of silently sending protected manuscripts through a weaker route.

## Same-project concurrency architecture

PARABLE no longer treats a mutable Blob called "latest" as the only source of truth for important project mutations.

The current hot-state path uses:

- one strongly-consistent **project revision head** per project;
- conditional ETag writes (`onlyIfMatch`) for optimistic compare-and-swap;
- short mutation leases so only one writer can commit a project revision at once;
- an immutable per-mutation artifact store;
- state references written into the CAS-protected revision head;
- mutable "latest" records only as compatibility/read-performance caches;
- explicit 409 revision conflicts instead of silent last-write-wins overwrites.

The intended mutation protocol is now:

`compute -> acquire project revision lease -> stage immutable artifacts -> CAS commit head/state refs -> refresh mutable caches`

If two editors start from the same revision, one commit can advance the head and the other must reload/rebase instead of overwriting the winner.

This gives PARABLE a safe, zero-extra-database transactional **commit boundary** on the current Netlify Free deployment for the operations that have been migrated to it.

It is not identical to a general-purpose ACID relational database: complex operations involving arbitrary cross-project rows, SQL joins, foreign-key constraints, or multiple unrelated records still belong in PostgreSQL. The repository therefore keeps the prepared PostgreSQL schema as a future hot relational tier, but the application is no longer blocked on provisioning it before we can safely handle ordinary concurrent project edits.

## Failure isolation

The system is designed so:

- telemetry failure cannot break story generation;
- one failed model call does not corrupt the continuity snapshot;
- durable workloads retry transient 429/5xx/network errors;
- invalid jobs are not retried forever;
- failed workload events can enter Netlify's dead-letter lifecycle;
- duplicate client retries do not automatically duplicate model spend.

## Load-shedding philosophy

At high load, PARABLE should prefer:

1. accept the user's job quickly;
2. queue expensive work durably;
3. show queued/processing state;
4. retry transient provider failures;
5. preserve manuscript privacy;
6. return a degraded/local result when appropriate;
7. never fake success.

A slower truthful result is preferable to a fast corrupted film state.

## SLO targets for the first serious load gate

For the read/API tier:

- error rate below 1%;
- p95 read latency below 1.5 seconds under the synthetic test;
- no cross-project data leakage;
- no process crash at 1,000 virtual users.

For AI workloads:

- submission endpoint p95 below 1 second;
- job acceptance remains available during provider slowdown;
- transient failures retry automatically;
- idempotent duplicates do not create duplicate work;
- queue recovery succeeds after temporary provider failure.

AI completion latency is measured separately from API acceptance latency because third-party model queues are outside PARABLE's direct control.

## Manual 1,000-user load test

The repository includes a k6 test and a manual GitHub Actions workflow.

It ramps through progressively higher traffic and reaches 1,000 virtual users against read-only / low-cost endpoints. Expensive AI generation is intentionally excluded from the default 1,000-user test to avoid accidental provider cost.

A separate controlled workload test should be used for AI throughput after provider quotas are known.

The repository also has an automated **Durable Pipeline Smoke** gate. It resolves the immutable Netlify Deploy Preview for the exact Git commit, submits a zero-cost queue probe, waits for the worker to execute it, verifies idempotent replay returns the same job, and verifies an idempotency-key payload conflict is rejected. Pinning CI to the immutable deploy prevents later branch pushes from moving the preview alias underneath a long-running test.

## Infrastructure rule going forward

Every new PARABLE engine should be classified before implementation as one of:

- synchronous read;
- small synchronous mutation;
- durable asynchronous workload;
- immutable asset/snapshot;
- transactional state.

No future engine should place expensive AI inference directly on a fragile request path merely because that is easier to code.


## Infrastructure portability

PARABLE's scale architecture is deliberately not "Netlify-only".

The queue layer is behind a PARABLE dispatcher. The current deployment can use Netlify Background Functions and can later switch back to Async Workloads without changing Studio code.

The authoritative project-state protocol is application-defined: revision number, immutable artifact references, idempotency keys and optimistic conflicts. Those concepts can be moved to PostgreSQL, Supabase, Neon, RDS or another transactional store later without rewriting the film intelligence engines.

The renderer and AI providers are also behind engine/router boundaries. Platform limits should trigger an infrastructure migration or horizontal provider expansion, not force a rewrite of PARABLE itself.

There is no responsible architecture that is literally unlimited. The goal is that each capacity ceiling has a replaceable layer, backpressure strategy and migration path rather than becoming a product ceiling.
