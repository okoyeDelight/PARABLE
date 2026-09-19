# PARABLE Render Engine — Foundation V1.1

PARABLE's Render Engine is the bridge between the production brain and external image/video models.

The design principle is simple:

> A renderer paints pixels. PARABLE owns the film.

A provider must never become the source of truth for character identity, wardrobe, props, story knowledge, camera intent, cultural grounding or accepted continuity.

## Production path

`Story -> Story Understanding -> Production Bible -> Continuity Brain -> Director -> Visual Canon -> Shot Compiler -> Keyframe Gate -> Render Router -> Render Attempt -> QA -> Repair / Accept -> Sequence Assembly`

## 1. Visual Canon

Endpoint:

`GET/POST /api/visual-canon`

The Visual Canon is the approved visual identity layer for:

- characters;
- locations;
- props;
- wardrobe;
- voice/performance references;
- location layout/light references;
- style and cultural production notes.

It imports human-approved reference locks from Continuity Brain but keeps **rights approval separate from continuity approval**.

A face can be correct for continuity and still have unverified likeness rights.

Reference-rights states:

- approved;
- unverified;
- restricted;
- revoked.

Final rendering must not silently use restricted/revoked/unverified references.

## 2. Composition Intelligence

Composition is compiled as narrative intent, not a rotating preset library.

Current grammar includes:

- natural;
- rule of thirds;
- centered;
- negative space;
- frame within frame;
- golden spiral;
- S curve;
- V shape;
- leading lines;
- balanced two-shot;
- asymmetric tension.

The compiler records **why** a composition was selected.

Examples:

- isolation / absence -> negative space;
- conviction / ritual / authority -> centered;
- observation / confinement -> frame within frame;
- relationship dialogue -> balanced two-shot;
- threat / instability -> asymmetric tension;
- discovery / reveal -> guided progressive composition.

The default intensity is deliberately restrained. PARABLE should not make every frame look like a photography contest.

## 3. Provider-neutral ShotRenderSpec

Endpoint:

`POST /api/shot-compile`

A `ShotRenderSpec` is renderer-independent.

It contains:

- dramatic beat and purpose;
- emotional intent;
- camera / lens / motion;
- composition plan;
- lighting continuity;
- performance restraint;
- pre-shot world state;
- in-shot transitions;
- post-shot world state;
- approved references;
- hard continuity constraints;
- negative constraints;
- output duration / aspect / FPS;
- provider capability requirements;
- human-review requirements.

The spec receives a stable SHA-256 hash.

A provider/model is therefore an execution choice, not the identity of the shot.

## 4. Keyframe-first gate

Endpoint:

`POST /api/keyframe-plan`

PARABLE plans the first frame before final motion generation.

The plan includes:

- first-frame canon requirements;
- composition;
- camera;
- lighting;
- performance;
- required references;
- forbidden changes;
- mid-shot stability checkpoint;
- end-frame handoff checkpoint;
- acceptance checklist.

This protects cost and continuity: a bad still/anchor concept should be corrected before spending more money generating motion.

## 4.1 Persisted human approval gate

Endpoints:

- `POST /api/keyframe-approval`
- `GET /api/keyframe-approval`

The keyframe plan is no longer advisory.

A final-motion attempt can be created only when PARABLE has an authoritative human approval record for:

- the exact project/story/scene/shot;
- the exact `ShotRenderSpec.spec_hash`;
- the exact keyframe-plan hash;
- one immutably bound image asset;
- all first-frame canon checks.

Approvals are immutable project artifacts referenced by the authoritative project revision head.

Revoking the approval immediately locks final motion again.

The dispatcher re-reads the approval immediately before the provider call. If the approval record, image URI or plan hash changed after the attempt was created, dispatch is refused and a new attempt must be created. This prevents a time-of-check/time-of-use race from spending money on a stale or swapped frame.

## 4.2 Durable first-frame generation

Endpoints:

- `POST /api/jobs` with `kind=keyframe-generate`
- internal worker target: `POST /api/keyframe-generate`
- immutable asset delivery: `GET /api/keyframe-asset?id=<sha256>`

First-frame generation is deliberately a durable billable job rather than a browser request.

The generator:

- requires an exact compiled ShotRenderSpec and KeyframePlan;
- refuses unresolved production-rights/human-review blockers;
- uses an idempotency key through PARABLE's durable queue;
- limits first-frame generations per shot;
- sends only rights-approved production references to the image model;
- keeps inspiration-only movie frames out of model identity inputs;
- stores the returned image as a content-addressed immutable asset;
- records the provider-reported cost when available;
- returns the SHA-256 and immutable asset URL;
- never auto-approves the frame.

The current image path uses OpenRouter's unified image API with a configurable model. The default development model is `google/gemini-3.1-flash-image`. Provider routing requests no-data-collection / ZDR-compatible handling; if the provider cannot satisfy the required policy, PARABLE fails closed instead of silently relaxing it.

## 4.3 Protected Visual Inspector

Endpoint:

`POST /api/keyframe-inspect`

The Visual Inspector checks a candidate before a human decides whether it becomes canon.

It can evaluate, where evidence is actually available:

- identity continuity;
- wardrobe and visible injuries;
- props;
- spatial geography;
- composition;
- lighting;
- cultural grounding;
- technical defects;
- image artifacts.

The inspector explicitly supports `not_assessable` rather than inventing confidence.

Its decisions are:

- `CLEAR_FOR_HUMAN_REVIEW`;
- `REPAIR_BEFORE_REVIEW`;
- `INSPECTOR_UNAVAILABLE`.

It never produces a human approval.

If it returns `REPAIR_BEFORE_REVIEW`, PARABLE blocks approval unless a human explicitly overrides that exact report and writes a reviewer note. The override is stored in the approval provenance.

## 4.4 Christian-film inspiration library and likeness boundary

PARABLE can learn from Christian cinema — including frames supplied from official Mount Zion / other Christian-film sources — without treating an unlicensed actor face as production identity.

Visual Canon references now distinguish:

- `identity`;
- `performance`;
- `wardrobe`;
- `location`;
- `production-design`;
- `visual-style`;
- `inspiration-only`;
- `benchmark-only`.

An external/official-media actor image can be stored as `inspiration-only` even when exact likeness rights have not been granted. PARABLE may derive transferable notes about performance restraint, grooming/silhouette, costume language, composition, lighting, color, production design and observable cultural details.

The original image is not sent to the final renderer as an identity reference.

Endpoint:

`POST /api/jobs` with `kind=reference-profile`

The durable reference profiler creates a non-identifying cinematic-DNA profile and explicitly records what not to copy.

If a production later obtains permission/license for an actor's likeness, the same reference can be deliberately promoted into the identity lane with `rights_status=approved`. Until then, PARABLE synthesizes a distinct actor identity.

## 5. Render Router

Endpoint:

`GET/POST /api/render-route`

The router scores only routes that satisfy the ShotRenderSpec.

PARABLE currently weights:

1. continuity preservation;
2. visual quality;
3. reliability;
4. cost;
5. latency.

It does **not** choose the fastest route when that route cannot preserve the film.

Provider/model choices are runtime-configured.

### fal adapter

Foundation V1 includes a versioned adapter for:

`bytedance/seedance-2.0/us/reference-to-video`

The adapter was written against the live model schema and supports:

- up to 9 image references;
- up to 3 video references;
- 4–15 second duration;
- supported cinematic aspect ratios;
- reference tokens in the generated provider prompt;
- 480p draft / 720p final mapping;
- separate-audio strategy.

PARABLE disables native audio for this adapter because dialogue, ambience, Foley and music are intended to remain editable stems.

Runtime dispatch requires a server-side `FAL_KEY` and configured `FAL_VIDEO_MODEL`.

The ChatGPT fal connector is useful to development/operator workflows, but it is not automatically a secret inside the deployed Netlify runtime.

### Runway

Runway is treated as another renderer, not as PARABLE itself.

The development connector can be used for operator-driven image/video work. The deployed app intentionally does not guess a Runway HTTP payload: a tested runtime adapter must be added before PARABLE sends production ShotRenderSpecs directly from the app.

## 6. Render Attempt Ledger

Endpoint:

`GET/POST /api/render-attempts`

Every generation is an attempt.

The ledger records:

- attempt id;
- draft/final mode;
- ShotRenderSpec hash;
- provider/model;
- provider request id;
- status;
- output asset;
- latency;
- estimated/actual cost;
- failure class;
- immutable status events.

A failed generation never overwrites a successful one.

An accepted take is committed into the project's authoritative revision head as an immutable project artifact.

## 7. Dispatch and provider polling

Endpoints:

- `POST /api/render-dispatch`
- `GET /api/render-provider-status`

The current fal path submits through the provider queue, stores the request id, polls safely, and ingests the returned video URL into the attempt ledger.

Receiving a video URL does **not** mean the shot is in the movie.

It only means the attempt reached `succeeded`.

## 8. Render QA

Endpoint:

`GET/POST /api/render-qa`

QA currently defines and evaluates evidence across:

- identity;
- wardrobe;
- prop continuity;
- spatial continuity;
- composition;
- motion;
- lighting;
- technical quality;
- audio sync;
- cultural grounding;
- performance intent.

Decisions:

- PASS;
- REPAIR;
- HUMAN_REVIEW;
- REJECT.

Repair plans prefer targeted intervention:

- reframe;
- edit video;
- regenerate segment;
- regenerate shot;
- audio-only repair;
- human review.

Important: Foundation V1 does not pretend it has inspected pixels when it has not. The QA endpoint evaluates supplied measured evidence.

The next QA layer should add an automated Visual Inspector that samples frames and produces these measurements.

## 9. Studio integration

PARABLE Studio now has a sixth stage:

`06 · RENDER`

For the selected shot it can automatically:

1. build/reuse the Visual Canon;
2. establish scene continuity;
3. establish sequential shot continuity;
4. compile the ShotRenderSpec;
5. build the keyframe plan;
6. query the Render Router.

Media generation remains an explicit action.

## Loopholes already addressed

- Provider lock-in -> provider-neutral ShotRenderSpec.
- Character drift -> Visual Canon + hard identity constraints.
- Mechanical composition -> narrative motivation and restrained intensity.
- Prop teleportation -> Continuity Brain world state.
- Knowledge leaks -> Continuity Brain character knowledge.
- Expensive bad video -> keyframe-first gate.
- Duplicate/failed generations -> immutable attempt ledger.
- Provider returns HTTP 200 but bad art -> QA is separate from provider success.
- Infinite regeneration -> repair decisions are explicit and attempts remain countable/costed.
- Rights confusion -> visual approval and rights approval are separate.
- Cross-provider switching -> canonical references and identical ShotRenderSpec survive the switch.
- Runtime provider schema drift -> adapters are model/version-specific; unknown models are refused instead of guessed.

## Important remaining work

Foundation V1 is not the finished autonomous film studio.

The highest-value next layers are:

1. automated full-video Visual Inspector with sampled-frame and motion evidence;
2. image-model benchmark suite using difficult PARABLE first-frame shots;
3. human-review gallery for multiple keyframe candidates;
4. room topology / 180-degree camera axis memory;
5. sequence-level QA between the previous shot's last frame and the next shot's first frame;
6. dedicated dialogue / ambience / Foley / music stems;
7. FFmpeg/Remotion sequence assembly;
8. provider cost/credit budgets and per-production spend ceilings;
9. durable render workers outside the browser request path;
10. object storage/CDN for large immutable media assets.

The goal is not to make PARABLE depend on the current best renderer.

The goal is to make every future renderer plug into a production system that already knows what the film is.
