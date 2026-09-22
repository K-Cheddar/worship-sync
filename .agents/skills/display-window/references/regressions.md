# Transition regression contracts

Current delayed-media contract: live file-video A -> B keeps the complete old
foreground and media visible while B's required live frame is delayed. Full
transitions do not animate their foreground and media independently. Once both
incoming planes are ready, one GSAP timeline crossfades them together.

Focused coverage belongs in `DisplayBoxTransitionStage.test.tsx`.

- Live file-video A → B stays `preparing` after B's poster is ready and animates only after B presents a live frame.
- Electron pool A -> B keeps A's lane fallback active while A is merely ready, adopts B's prepared wrapper only at the transition boundary, and keeps B's owner through a content-only change.
- Same video with changed lyrics keeps one mounted media node and only fades content.
- Rapid A → B → C retains C; obsolete timeline completion cannot restore B.
- Content settles do not re-expose stale lyrics.
- The content plane stays above media after either A/B lane wins.
- Do not clear outgoing opacity before React removes old content; that is the known one-frame flash regression.
- An opaque `local-video-file://` reference is resolved before candidate
  eligibility and never reaches a prepared `<video>`.
- An unresolvable prepared candidate reports failure and releases the stage to
  the live fallback; the stage must not remain in `preparing` indefinitely.
- Adopted prepared ownership survives transient readiness and geometry changes.
- A source improvement from a remote URL to `media-cache://` does not reload an
  active prepared video; the improved source is used after ownership ends.
- Controller outline changes update projector/editor preparation immediately,
  with presentation and auxiliary scopes isolated.
- A failed media-document read does not call destructive cache cleanup, while a
  successful empty document still does.
- Media cache redirects 301, 302, 303, 307, and 308 are followed with each
  redirect response disposed.

When readiness changes, also cover image, local-video-input, and non-animated paths.

The Electron pool has separate utility coverage for deterministic candidate
priority, protected identities, and eviction reporting. Surface lifecycle
coverage belongs with the generation/state tests and output-stage integration
tests; browser and non-Electron paths must remain covered by the existing lane
media tests.
