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

The live development build currently runs in Floot. This repository is the source/checkpoint mirror used after each completed build day.

## Product principle

PARABLE should not simply generate *for* a place or audience. It should understand enough verified context to create *from inside* that world while keeping writers and human reviewers in control.

## Current checkpoint

**Story Intelligence V8 + Continuity Brain V2 — September 18, 2026**

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
- human director overrides layered onto the shot plan without bypassing continuity
- renderer hard constraints for identity, wardrobe, injury, props, screen geography and character knowledge

The production path is now:

`Story -> Story Understanding -> Production Bible -> Scene State -> Continuity Gate -> Director Controls -> Render Package -> Renderer`

The next Continuity milestone is deeper physical-world memory: prop ownership and transfers, spatial graphs / screen direction, per-shot transitions, casting reference IDs, location visual references and continuity-aware renderer seeds.

`main` remains unchanged until the `immersive-v2` checkpoint is deliberately approved and merged.
