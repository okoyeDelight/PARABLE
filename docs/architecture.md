# PARABLE architecture — Day 1

PARABLE is a global Christian story-to-screen production studio. The durable product is the orchestration and intelligence layer, not any one video-generation model.

## Core principles

1. **Writer-first.** Writers write stories; they should not have to become prompt engineers.
2. **Global by design.** Nigeria is an important test case, not a boundary. Audience, setting, language and cultural context are explicit project dimensions.
3. **Living context.** Current events, local institutions, public/authorised sources and user-provided organisation knowledge can ground a project in a real place and moment.
4. **Location grounding.** Map/place data, openly licensed aerial imagery and authorised reference photos can form a Place Bible / digital location twin.
5. **Film intelligence before rendering.** Story direction, performance direction, cinematography, editing, sound and continuity are separate reasoning layers that instruct renderers.
6. **Replaceable renderers.** Video, image, voice and lip-sync models sit behind adapters. PARABLE must survive model changes.
7. **Continual improvement.** Cultural knowledge and retrieval update frequently; adapters/models retrain only through evaluated, versioned pipelines with rollback.
8. **Human authority.** Writers, editors, theology reviewers and directors remain final decision-makers.
9. **Rights-aware.** Do not clone a real person's face or voice without permission. Do not treat copyrighted films or restricted map imagery as an unrestricted training corpus.

## Engine boundaries

- Story Intelligence
- Film Intelligence
- Cultural Intelligence
- Location Grounding
- Performance / Audio
- Render Router
- Continual Learning

These modules are intentionally independent so each can be improved or replaced without rewriting the whole product.

## Day 1 data model

### projects
Stores the writer's project and its high-level creative grounding: title, source text, logline, setting, primary audience, audience scope, story period, production status and progress.

### project_contexts
Stores typed context attached to a project: audience, culture, location, organisation and time. Context is versionable/refreshed independently from the story itself.

### engine_modules
Registry for the seven major intelligence/production engines and their current implementation status.

## Near-term sequence

Day 2 onward expands this foundation into story analysis, Story Bible, character/location extraction, episode adaptation, continuity, directing and eventually generation. Every major stage should be tested with real story content before the next layer is built.
