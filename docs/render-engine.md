# PARABLE Render Engine — Foundation V1

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

1. automated frame/video Visual Inspector;
2. keyframe image generation + human approval UI;
3. model benchmark suite using difficult PARABLE shots;
4. room topology / 180-degree camera axis memory;
5. sequence-level QA between the previous shot's last frame and the next shot's first frame;
6. dedicated dialogue / ambience / Foley / music stems;
7. FFmpeg/Remotion sequence assembly;
8. provider cost/credit budgets and per-production spend ceilings;
9. durable render workers outside the browser request path;
10. object storage/CDN for large immutable media assets.

The goal is not to make PARABLE depend on the current best renderer.

The goal is to make every future renderer plug into a production system that already knows what the film is.
