# PARABLE security and multi-tenant boundary

A system that can handle 1,000 concurrent users is not production-safe if users can see or mutate one another's manuscripts. Scale and authorization are therefore separate requirements.

## Non-negotiable authorization rule

Knowing a `projectId` must never be enough to access a production project.

Before public multi-user launch, every project read or mutation must resolve:

`authenticated identity -> active PARABLE user -> active workspace membership -> project workspace -> allowed role/action`

The prepared PostgreSQL schema is in `database/tenancy-v1.sql`.

## Provider-neutral identity

PARABLE should not make its project data model depend on one login vendor.

The application stores an internal user id plus:

- identity provider;
- immutable provider subject;
- workspace memberships;
- project/workspace ownership.

That allows the login provider to be changed later without changing every project id or continuity record.

## Workspace roles

Prepared roles are:

- owner;
- admin;
- editor;
- reviewer;
- viewer.

Story writers and directors need edit permissions. Reviewers should be able to inspect/review without silently changing the author's production state. Viewers are read-only.

## Queue authorization

Durable jobs must eventually carry a server-validated actor/workspace context.

A browser-supplied workspace id alone is not authorization.

The job worker must re-check authorization or consume a cryptographically trusted server-created claim before mutating hot project state. This prevents a queued job from becoming an authorization bypass.

## Storage isolation

Production keys and transactional rows should be scoped by workspace/project even when project ids are globally unique.

Operational telemetry must not contain manuscript text, prompt text, identity tokens, session tokens, API keys or stored job payloads.

## Current state

The tenancy database schema is prepared but an identity provider has **not** been selected or provisioned yet.

The current `immersive-v2` branch is therefore still an engineering/deploy-preview environment, not a claim that public multi-tenant security is complete.

Before exposing PARABLE to real public accounts, the minimum gate is:

1. activate transactional PostgreSQL hot state;
2. choose/connect the authentication provider;
3. implement workspace membership checks on every project route;
4. propagate trusted actor/workspace context into durable jobs;
5. add authorization regression tests (cross-workspace read/write must fail);
6. run the 1,000-user load gate with realistic authenticated traffic.

This boundary should be built before public scale, not patched in afterward.
