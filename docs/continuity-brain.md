# PARABLE Production Bible / Continuity Brain — V2

PARABLE remembers a film as a world instead of treating every scene as a fresh prompt.

V2 moves the Continuity Brain beyond manual structured updates. PARABLE can now extract scene state automatically, compare it with the established Production Bible and prior scenes, block serious continuity contradictions, then generate a continuity-gated render package for every shot.

## What the Continuity Brain remembers

The current snapshot tracks:

- character identity and locked visual / performance facts;
- appearance, clothing / wardrobe and emotional state;
- character position and current location;
- injuries and other stateful physical changes;
- props and prop state;
- relationship state;
- what each character currently knows;
- scene order and current time label;
- unresolved story threads;
- Scripture / theology review flags;
- every accepted state transition and continuity warning.

Durable character identity facts can be locked. Stateful changes such as wardrobe, injury, location or emotion are allowed when the scene explicitly establishes a transition.

## Automatic scene-state extraction

`POST /api/scene-state`

Example:

```json
{
  "projectId": "project_123",
  "storyVersion": "story_abc",
  "mode": "apply",
  "scene": {
    "id": "scene_17",
    "index": 17,
    "heading": "INT. KITCHEN - NIGHT",
    "text": "Daniel stands in the doorway..."
  }
}
```

If scene text is omitted, PARABLE attempts to derive the current scene from the latest adaptation.

The protected Continuity Intelligence lane requests Zero Data Retention / no-training routing through OpenRouter. If a compliant provider is unavailable, PARABLE falls back to conservative local extraction rather than weakening manuscript privacy.

The extraction stage produces:

- scene facts;
- explicit state transitions;
- character knowledge gained or forgotten;
- knowledge requirements that may expose information leaks;
- unresolved / resolved story threads;
- theology review flags;
- renderer notes for identity, wardrobe, props, spatial relationships and emotional continuity;
- uncertainties and model/fallback provenance.

## Knowledge-leak detection

A scene can now be blocked if a character acts on information continuity does not record them learning.

Example:

Scene 8 records that only Miriam sees the letter.

If Scene 9 makes Daniel confront someone about the letter before learning about it, the Continuity Brain can emit:

`KNOWLEDGE_LEAK`

with blocker severity.

This is deliberately evaluated before new knowledge from the scene is applied.

## Identity and state locks

V2 distinguishes durable identity from legitimate story change.

A locked identity contradiction can produce:

`LOCKED_FACT_CONFLICT`

while an unexplained wardrobe, injury, emotional, location or prop-state change can produce:

`UNEXPLAINED_CHANGE`.

Explicit transitions are recorded in history rather than treated as errors.

## Render handoff

`GET /api/render-context?projectId=project_123&sceneId=scene_17`

Optional query parameters:

- `storyVersion`
- `shotId`

The render endpoint refuses to treat an unchecked scene as render-ready.

For a checked scene it returns one package per shot containing:

- the shot plan;
- human director overrides where present;
- the current continuity contract;
- locked character identity;
- wardrobe, injury, prop and location state;
- character knowledge;
- unresolved story threads;
- theology flags;
- scene-specific render notes;
- hard continuity blockers;
- a final `can_render` gate.

The renderer boundary therefore becomes:

`Story -> Production Bible -> Scene State -> Continuity Gate -> Director Controls -> Render Package -> Renderer`

not:

`Scene text -> random new video prompt`.

## Manual continuity API

The lower-level `/api/continuity` endpoint still exists for human/editorial control.

It supports:

- `bootstrap`
- `check_scene`
- `apply_scene`

and current continuity can be read with:

`GET /api/continuity?projectId=project_123`

or compacted for downstream engines with:

`GET /api/continuity?projectId=project_123&compact=1`

## Current limitations

V2 is scene-level, not yet frame-level.

The next layer should add:

- automatic prop ownership and hand-to-hand transfers;
- richer spatial graph / screen-direction memory;
- per-shot state transitions inside a scene;
- actor face / voice reference IDs after casting;
- location visual reference IDs;
- continuity-aware image/video seed management;
- automatic repair suggestions that never overwrite writer/director choices without approval.

By Scene 17, PARABLE now has an enforceable memory of Scenes 1–16. The next milestone is making every renderer consume that memory automatically.
