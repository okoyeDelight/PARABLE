# PARABLE Production Bible / Continuity Brain — V1

PARABLE must remember a film as a world, not regenerate each scene as an isolated prompt.

This checkpoint adds a provider-independent continuity layer before video rendering. It is deliberately separate from model routing so continuity remains durable even when AI providers change.

## What the Continuity Brain remembers

The current V1 snapshot tracks:

- character identity and established facts;
- appearance, clothing / wardrobe and emotional state;
- character position and location;
- injuries and other stateful physical changes;
- props and prop state;
- relationship state;
- what each character currently knows;
- scene order and current time label;
- unresolved story threads;
- Scripture / theology review flags;
- a history of state transitions and continuity warnings.

The compact continuity context is designed to be injected into later screenplay, directing, image, video, voice and editing stages without sending the entire raw manuscript again.

## API

### Bootstrap from the Production Bible

`POST /api/continuity`

```json
{
  "action": "bootstrap",
  "projectId": "project_123",
  "storyVersion": "story_abc"
}
```

If `productionBible` is omitted, PARABLE loads the latest adaptation first, then the latest Story Understanding for that project.

### Check a scene without changing memory

`POST /api/continuity`

```json
{
  "action": "check_scene",
  "projectId": "project_123",
  "scene": {
    "id": "scene_17",
    "index": 17,
    "facts": [
      {
        "entity": "Daniel",
        "kind": "character",
        "field": "clothing",
        "value": "blue shirt",
        "transition": false
      }
    ]
  }
}
```

The response includes `can_render` plus warnings such as:

- `LOCKED_FACT_CONFLICT` — a protected identity fact was contradicted;
- `UNEXPLAINED_CHANGE` — a stateful fact changed without a declared transition;
- `TIMELINE_REGRESSION` — a scene attempts to move behind the current scene cursor;
- `MISSING_ENTITY` — the scene submitted an unusable continuity fact.

### Apply a scene and advance the world

Use the same payload with `"action": "apply_scene"`.

A legitimate change should be marked with `"transition": true`. That means PARABLE remembers both the old state and the new state rather than treating the new value as an accidental continuity error.

### Read current continuity

`GET /api/continuity?projectId=project_123`

For a renderer-friendly payload:

`GET /api/continuity?projectId=project_123&compact=1`

## Character knowledge

Scene updates can explicitly advance or remove knowledge:

```json
{
  "knowledge": [
    {
      "character": "Daniel",
      "learns": ["The letter was written by Miriam"],
      "forgets": []
    }
  ]
}
```

Later dialogue/directing stages should consult this state so a character cannot react to information they have not yet learned.

## Why this comes before rendering

By Scene 17, the renderer should not invent a different Daniel, room, wardrobe, prop position or emotional state because Scene 17 is not a fresh generation request. It is the next moment inside an already-established world.

V1 is the deterministic memory and conflict layer. The next Continuity Brain stage is automatic scene-state extraction from the screenplay / shot package plus stronger knowledge-leak checks, identity locks, prop ownership, spatial relationships and render handoff.
