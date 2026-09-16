# PARABLE Web

PARABLE is now website-first and GitHub is the source of truth.

## Current architecture

- `web/public/` — cinematic PARABLE frontend
- `netlify/functions/projects.mjs` — persistent project API
- `netlify/functions/engines.mjs` — studio engine registry API
- `netlify.toml` — publishes `web/public` and maps `/api/*` to the Netlify backend
- Netlify Blobs — persistent server-side project and context storage

The frontend continues to call `/api/projects` and `/api/engines`, so the product UI is decoupled from the hosting provider.

## Current product foundation

- cinematic story-studio workspace
- persistent project list
- real New Story backend write
- audience scope, setting and story-period grounding
- project context persisted separately for future Living Context work
- seven modular engine statuses
- responsive desktop/mobile navigation and motion system

## Design direction

PARABLE is not a generic AI dashboard. It is a cinematic operating system for storytellers: content-first hierarchy, restrained glass/materials, contextual controls, shared-element transitions, progressive disclosure, and motion that communicates spatial relationships.

The product architecture remains modular: Story, Film, Culture, Location, Performance/Audio, Rendering and Continual Learning stay separate so each layer can improve independently.
