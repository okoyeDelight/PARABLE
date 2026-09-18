# PARABLE Production Bible / Continuity Brain — V3

PARABLE now treats continuity as a physical world timeline, not only scene memory.

V3 adds object ownership, hand-to-hand prop transfers, screen geography, per-shot state transitions and human-approved visual / voice reference locks.

## Current production path

`Story -> Story Understanding -> Production Bible -> Scene State -> Shot State -> Continuity Gate -> Director Controls -> Render Package -> Renderer`

A renderer should never rebuild the world from a bare prompt. It receives a world-state contract.

## Physical world memory

The V3 continuity snapshot now stores:

- durable character identity and approved reference IDs;
- wardrobe, injuries, emotional state, position and location;
- what each character knows;
- props, current holder, current location and current state;
- scene and shot transition history;
- spatial relationships such as left/right, foreground/background, facing and screen side;
- unresolved story threads and theology-review flags;
- continuity warnings and blockers.

Old V1/V2 snapshots are upgraded in memory to V3 when used.

## Prop ownership and transfers

Scene or shot extraction can return `prop_transfers`.

Example:

```json
{
  "prop": "house keys",
  "from": "Daniel",
  "to": "Miriam",
  "location": "",
  "state": "held",
  "transition": true,
  "confidence": 0.94
}
```

PARABLE then remembers who holds the keys.

If a later shot claims the keys come from someone who never received them, the Continuity Brain can emit `PROP_OWNERSHIP_CONFLICT` and stop the render package.

Putting an object down is represented by clearing its holder and assigning a location.

## Spatial graph and screen direction

V3 stores filmable geography through `spatial_relations`.

Supported relations include:

- left_of / right_of;
- in_front_of / behind;
- inside / outside;
- near / facing;
- screen_left / screen_right;
- foreground / background.

An unexplained screen-side reversal can emit `SCREEN_DIRECTION_BREAK`.

The point is not to forbid camera changes. The point is to require a real movement, blocking or camera transition before PARABLE silently flips established geography.

## Scene checkpoint

`POST /api/scene-state`

The scene checkpoint now stores both:

- `continuity_before_snapshot`
- `continuity_after_snapshot`

This gives the per-shot timeline a clean pre-scene starting state without losing the scene-level final state used by the next scene.

## Per-shot continuity

`POST /api/shot-state`

Required fields:

```json
{
  "projectId": "project_123",
  "storyVersion": "story_abc",
  "sceneId": "scene_17",
  "shotId": "shot_3"
}
```

Shots must be processed in order.

The first shot starts from the scene's pre-scene checkpoint. Every later shot starts from the previous shot's post-shot snapshot.

Each shot stores:

- pre-shot continuity;
- extracted in-shot state changes;
- prop transfers;
- spatial movement;
- knowledge changes;
- post-shot continuity;
- blockers and uncertainties;
- pre-shot and post-shot render contracts.

This means a prop picked up in Shot 2 is already in that character's hand when Shot 3 is prepared.

## Render gate V2

`GET /api/render-context?projectId=project_123&sceneId=scene_17`

A shot is no longer render-ready merely because its scene passed continuity.

Every shot must have a `/api/shot-state` checkpoint.

The render package now carries:

- shot plan plus human director overrides;
- continuity before the shot;
- in-shot transitions;
- continuity after the shot;
- prop ownership;
- spatial graph;
- locked identity / casting references;
- knowledge state;
- hard blockers;
- human-review recommendation.

Unchecked shots are returned as `awaiting-shot-continuity` and `can_render=false`.

## Human-approved reference locks

`POST /api/reference-locks`

Reference locks cannot be created silently by a model. The request must include:

`"humanApproved": true`

Supported character references include:

- actor_face_ref;
- actor_visual_ref;
- voice_ref;
- wardrobe_reference_ref;
- performance_reference_ref.

Supported location references include:

- location_visual_ref;
- layout_reference_ref;
- lighting_reference_ref.

Once locked, renderer contracts carry them as durable identity / place constraints.

Replacing an existing locked reference requires `replaceExisting=true`, making a recast or deliberate location redesign explicit rather than accidental.

## Privacy boundary

Automatic scene and shot extraction remains on PARABLE's protected manuscript lane.

It requests provider routing with Zero Data Retention and data-collection denial. If that requirement cannot be satisfied, PARABLE uses conservative local extraction instead of weakening manuscript privacy.

## What V3 changes in practice

If Scene 4 establishes that Daniel places the keys on the dining table, the system can preserve that fact.

If Shot 2 of Scene 9 has Miriam pick them up, Shot 3 begins with Miriam holding the keys.

If Shot 4 suddenly renders Daniel holding them again without a handover, PARABLE has enough physical-world state to stop and ask why.

That is the shift from prompt continuity to production continuity.

## Next milestone

The next Continuity Brain layer should focus on:

- camera-axis / 180-degree rule memory;
- room topology and persistent furniture landmarks;
- entrances/exits and door state;
- per-character pose and eyeline continuity;
- continuity-aware renderer seed/reference management;
- automatic repair proposals that remain advisory until a human approves them.
