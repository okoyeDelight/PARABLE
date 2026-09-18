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

**Story Intelligence V8 + Continuity Brain V3 + Scale Foundation V1 + Render Engine Foundation V1.1 — September 18, 2026**

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
- authoritative project revision head + compare-and-swap commit boundary + immutable project artifacts for safer concurrent editing
- Visual Canon for character/location/prop identity and human-approved references
- separate reference-rights status so continuity approval is not confused with likeness/media permission
- Composition Intelligence that chooses framing for narrative reasons rather than cycling visual presets
- provider-neutral ShotRenderSpec with stable hashes and renderer capability requirements
- keyframe-first planning so PARABLE approves the visual world before expensive motion generation
- Render Router that prioritizes continuity/identity over speed
- versioned fal Seedance 2 reference-to-video adapter based on its live input schema
- immutable Render Attempt Ledger with provider/model/request/cost/failure history
- Render QA contracts with PASS / REPAIR / HUMAN_REVIEW / REJECT outcomes and targeted repair plans
- Studio stage 06 · RENDER wired through canon, scene continuity, sequential shot continuity, compilation, keyframe planning and renderer routing
- persisted human first-frame approval bound to the exact ShotRenderSpec, keyframe-plan hash and immutable image
- approval revocation plus dispatcher-time revalidation so stale/swapped keyframes cannot reach final motion
- durable, idempotent first-frame generation with a per-shot generation ceiling and provider-reported cost telemetry
- content-addressed immutable keyframe assets served by SHA-256
- protected Visual Inspector for identity/wardrobe/props/geography/composition/lighting/cultural/technical checks, with explicit not-assessable states
- human override provenance when a reviewer deliberately accepts a Visual Inspector blocker
- exact approved-first-frame image-to-video conditioning for final motion
- rights-aware Christian-film inspiration lane: official movie frames can inform original casting/cinematography language without silently becoming actor-identity inputs
- durable cinematic-reference profiling for Christian movie frames, including non-identifying casting archetype, performance, composition, light, costume and production-design lessons

The production path is now:

`Story -> Story Understanding -> Production Bible -> Scene State -> Shot State -> Continuity Gate -> Director -> Visual Canon -> Shot Compiler -> Keyframe Gate -> Render Router -> Render Attempt -> QA -> Repair / Accept -> Sequence Assembly`

The next film-system milestone is full-video Visual Inspection, first-frame model benchmarking, camera-axis / 180-degree memory, room topology, sequence-level QA, editable audio stems and FFmpeg/Remotion sequence assembly.

The current **scale target** is 1,000 simultaneous active users. The architecture is now designed around stateless horizontal request handling plus durable asynchronous AI work, but this target is not treated as a guarantee until the manual 1,000-user load gate passes on the intended production plan and third-party AI quotas are verified. Same-project mutations now use optimistic project revisions, short leases, conditional compare-and-swap writes and immutable staged artifacts to prevent ordinary silent overwrites. A relational PostgreSQL tier is still appropriate later for complex multi-row collaboration, workspace membership, billing and other relational workloads; PARABLE does not pretend the current commit boundary is a general-purpose SQL transaction engine.

`main` remains unchanged until the `immersive-v2` checkpoint is deliberately approved and merged.
