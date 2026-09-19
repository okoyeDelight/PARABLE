# PARABLE final production pipeline

PARABLE now treats final-film creation as a chain of immutable, human-reviewable
contracts rather than a single "generate movie" call.

1. Story Intelligence and adaptation produce the Story/Production Bible.
2. Visual Canon and Continuity Brain compile provider-neutral ShotRenderSpecs.
3. A keyframe candidate is generated and inspected.
4. A persisted human first-frame approval binds the exact still, content hash,
   story version and ShotRenderSpec.
5. Final-motion dispatch re-checks that approval before provider submission.
6. Full-motion inspection and QA must clear the exact resulting asset, or a
   reviewer must explicitly record a full-motion override.
7. Accepted shots produce immutable continuity handoffs and are locked into a
   SequenceTimeline.
8. The Audio Plan derives dialogue, ambience, Foley and original-score cues from
   the locked sequence. It cannot be locked before the visual sequence is locked.
9. The Final Edit Plan binds the accepted clip attempts/spec hashes, the locked
   audio plan, captions and deterministic MP4 output contract.
10. The Final Film Manifest refuses readiness while required dialogue audio is
   missing or unapproved.
11. `tools/assemble_final_film.py` performs deterministic FFmpeg assembly only;
   it cannot generate or swap shots, so it cannot bypass the visual approval
   gates.

Voice policy defaults to original synthetic voices. Exact actor/person voice
cloning requires explicit rights/consent. Music defaults to an original
instrumental brief rather than imitation of a named artist or copyrighted work.

The assembler emits H.264/AAC MP4, 24fps/yuv420p, normalized to -14 LUFS / -1.5
dBTP with faststart. Every accepted clip remains traceable to its render attempt
and ShotRenderSpec.
