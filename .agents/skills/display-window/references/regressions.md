# Transition regression contracts

Current delayed-media contract: live file-video A -> B keeps the old media
visible while B's live frame is delayed. Meaningful foreground may animate
independently, and the media plane does not settle until B presents a live
frame. The old content may remain mounted at opacity zero until the media plane
settles. The earlier single-phase wording below is retained as historical
context and is superseded for independent full transitions.

Focused coverage belongs in `DisplayBoxTransitionStage.test.tsx`.

- Live file-video A → B stays `preparing` after B's poster is ready and animates only after B presents a live frame.
- Same video with changed lyrics keeps one mounted media node and only fades content.
- Rapid A → B → C retains C; obsolete timeline completion cannot restore B.
- Content settles do not re-expose stale lyrics.
- The content plane stays above media after either A/B lane wins.
- Do not clear outgoing opacity before React removes old content; that is the known one-frame flash regression.

When readiness changes, also cover image, local-video-input, and non-animated paths.

The Electron pool has separate utility coverage for deterministic candidate
priority, protected identities, and eviction reporting. Surface lifecycle
coverage belongs with the generation/state tests and output-stage integration
tests; browser and non-Electron paths must remain covered by the existing lane
media tests.
