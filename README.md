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

**Story Intelligence V8 + Continuity Brain V1 — September 18, 2026**

The `immersive-v2` branch now includes:

- protected manuscript routing with privacy-preserving provider failover
- Story Understanding before adaptation
- screenplay / shot-plan generation
- Film Quality Critic and provider health telemetry
- Production Bible persistence
- a provider-independent Continuity Brain
- scene-by-scene world-state memory for characters, wardrobe, emotion, location, props, relationships, timeline, knowledge and theology flags
- continuity conflict detection before render
- compact continuity context for later directing/render stages

The next build step is to connect automatic scene-state extraction and render handoff so every generated shot receives the exact established world state instead of treating each scene as a new prompt.

`main` remains unchanged until the `immersive-v2` checkpoint is deliberately approved and merged.
