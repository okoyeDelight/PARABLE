# PARABLE

**Stories made visible.**

PARABLE is a global Christian story-to-screen studio being built to help writers turn stories into culturally grounded, cinematic productions.

## Day 1 foundation

The first working build establishes:

- writer/project workspace
- persistent story projects
- audience, time-period and location-grounding context
- modular Story, Film, Culture, Location, Audio/Performance, Render and Continual-Learning engines
- a replaceable model-router architecture rather than dependence on one generation model
- human review, consent and rights-aware design principles

The current engineering preview is deployed from this repository through Netlify. `immersive-v2` remains isolated from `main` while infrastructure and production-engine gates are still being hardened.

## Product principle

PARABLE should not simply generate *for* a place or audience. It should understand enough verified context to create *from inside* that world while keeping writers and human reviewers in control.

## Current checkpoint

**Story Intelligence V8 + Continuity Brain V3 + Scale Foundation V1 — September 18, 2026**

The `immersive-v2` branch now includes:

- protected manuscript routing with privacy-preserving provider failover
- Story Understanding before adaptation
- screenplay / shot-plan generation
- Film Quality Critic and provider health telemetry
- Production Bible persistence
- persistent world-state memory for characters, wardrobe, emotion, locations, injuries, props, relationships, timeline, knowledge and theology flags
- automatic scene-state extraction through a protected Continuity Intelligence lane
- conservative local continuity extraction when protected model routing is unavailable
- identity locking and explicit state-transition history
- continuity conflict detection before render
- character knowledge-leak detection
- scene-level human-review flags and uncertainty provenance
- continuity-gated render handoff packages
- per-shot continuity checkpoints with pre-shot and post-shot world state
- prop ownership and hand-to-hand transfer memory
- spatial graph and screen-direction continuity
- human-approved actor/voice/location reference locks
- human director overrides layered onto the shot plan without bypassing continuity
- renderer hard constraints for identity, wardrobe, injury, prop ownership, screen geography and character knowledge
- redundant durable queue routing for Story Intelligence, Film Critic and continuity work: Async Workloads when healthy, Netlify Background Functions as claim-check fallback
- idempotent job submission so retries do not automatically duplicate expensive AI work
- retry/backoff and execution leases for transient provider/network failures and duplicate queue delivery
- refresh-safe Studio production jobs that can be restored after the browser reloads
- append-only sharded AI telemetry instead of a shared hot write key
- bounded/paginated project reads for safer high-concurrency traffic
- Deploy Preview platform-health and isolated scale-probe endpoints
- manual 1,000-virtual-user read-tier and durable-queue load gates
- PostgreSQL transactional hot-state schema prepared for multi-editor optimistic revision control
- provider-neutral scale strategy so queue, database, AI and render infrastructure can be replaced or expanded without rewriting PARABLE's production contracts

The production path is now:

`Story -> Story Understanding -> Production Bible -> Scene State -> Shot State -> Continuity Gate -> Director Controls -> Render Package -> Renderer`

The next Continuity milestone is camera-axis / 180-degree memory, room topology, entrances/exits, pose and eyeline continuity, continuity-aware renderer seeds, and advisory repair proposals.

The current **scale target** is 1,000 simultaneous active users. The architecture is now designed around stateless horizontal request handling plus durable asynchronous AI work, but this target is not treated as a guarantee until the manual 1,000-user load gate passes on the intended production plan and third-party AI quotas are verified. For multiple people editing the exact same project concurrently, the prepared PostgreSQL transactional state tier must be activated before claiming ACID-safe collaboration.

`main` remains unchanged until the `immersive-v2` checkpoint is deliberately approved and merged.
