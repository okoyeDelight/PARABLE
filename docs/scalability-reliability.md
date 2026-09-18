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
- retry with exponential backoff;
- dead-letter handling through Netlify Async Workloads;
- fast 202 responses to clients;
- load decoupling between user traffic and AI-provider latency.

Job status is read with:

`GET /api/jobs?id=job_xxx`

The endpoint supports idempotency through the standard `Idempotency-Key` request header. Repeated submissions with the same key and same payload resolve to the same durable job instead of paying for duplicate AI work.

Reusing the same idempotency key with a different payload returns a conflict.

### 3. Sequential shot continuity

Shots inside a scene are intentionally processed in order.

This is not an artificial limitation. Shot N+1 needs the physical state left by Shot N. The durable worker retries a shot that arrives before its predecessor rather than fabricating missing world state.

Different projects and different users can still execute concurrently.

### 4. Append-only high-volume telemetry

AI health telemetry no longer updates one shared aggregate blob on every request.

Each provider event is written to a unique sharded key. Health aggregates are derived from recent immutable events when read.

This removes a hot shared write key that would otherwise suffer lost updates under burst traffic.

### 5. Strong-consistency production reads

Mutable production Blob stores use strong consistency. Deploy previews continue using deploy-scoped stores so test traffic cannot alter production state.

### 6. Privacy boundary survives scale

Real manuscript data continues to use the protected provider lane. Scaling traffic never relaxes Zero Data Retention / data-collection requirements merely to obtain capacity.

If compliant inference is unavailable, PARABLE degrades to local conservative processing or a durable retry instead of silently sending protected manuscripts through a weaker route.

## Current known concurrency boundary

Netlify Blobs is excellent for highly available object storage and read-heavy state, but overlapping writes to the same key are last-write-wins and do not provide database transactions.

PARABLE therefore avoids depending on one globally-mutated key for high-volume telemetry and uses ordered workflows for shot state.

For **multiple people editing the exact same project at the exact same moment**, the long-term production state layer should use transactional PostgreSQL for hot mutable records while keeping Blobs for immutable snapshots, assets, job claim-check payloads and archives.

The repository contains a PostgreSQL foundation and the next database migration should introduce:

- project revision numbers;
- continuity event rows;
- transactional project locks / optimistic version checks;
- idempotency records;
- durable job metadata;
- immutable snapshot references.

Do not claim multi-editor ACID safety until that migration is active.

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

## Infrastructure rule going forward

Every new PARABLE engine should be classified before implementation as one of:

- synchronous read;
- small synchronous mutation;
- durable asynchronous workload;
- immutable asset/snapshot;
- transactional state.

No future engine should place expensive AI inference directly on a fragile request path merely because that is easier to code.
