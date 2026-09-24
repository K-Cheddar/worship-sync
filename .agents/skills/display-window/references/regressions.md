# Transition regression contracts

Current delayed-media contract: file-video A -> B starts the complete slide
transition as soon as B's prepared surface or poster is paint-ready. If B has no
poster, its live fallback frame is required. A selected poster remains owned by
the fallback player even if B's pool surface becomes ready during the slide.
Full transitions do not animate their foreground and media independently. The
foreground and selected incoming visual crossfade together on one GSAP
timeline; the later poster-to-video reveal animates only the background.

Focused coverage belongs in `DisplayBoxTransitionStage.test.tsx`.

- Browser file-video A → B animates to B's complete slide as soon as B's poster is ready, even before B's live frame.
- B's first presented frame after that slide transition fades only B's background from poster to video; lyrics do not restart.
- With neither B's poster nor video ready, A stays visible and the stage remains `preparing`.
- If the Electron pool is still preparing or fails while B's poster is ready, B's poster transition starts and the fallback player retains ownership.
- A prepared Electron B that is ready before selection is adopted directly without a poster handoff.
- Electron pool A -> B keeps A's lane fallback active while A is merely ready, adopts B's prepared wrapper only at the transition boundary, and keeps B's owner through a content-only change.
- Same video with changed lyrics keeps one mounted media node and only fades content.
- Rapid A → B → C retains C; obsolete timeline completion cannot restore B.
- Content settles do not re-expose stale lyrics.
- The content plane stays above media after either A/B lane wins.
- Do not clear outgoing opacity before React removes old content; that is the known one-frame flash regression.
- An opaque `local-video-file://` reference is resolved before candidate
  eligibility and never reaches a prepared `<video>`.
- An unresolvable prepared candidate reports failure and releases the stage to
  a ready poster or live fallback; the stage must not remain in `preparing` indefinitely.
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
