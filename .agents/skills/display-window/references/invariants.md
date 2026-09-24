# Audience-facing transition invariants

These are hard product rules: keep the current valid visual until its replacement is genuinely ready; never expose a black or empty frame between valid presentation states; and never let stale foreground content reappear after a newer operator request wins.

At transition selection, use an eligible prepared video when its prepared
frame is usable. Otherwise, a painted poster is an acceptable incoming visual
and must start the normal slide transition immediately. The fallback player
owns that poster-to-video handoff for the whole selection, even if a pool
surface finishes preparing later. With no ready poster, wait for a prepared or
fallback video frame; if neither is ready, preserve the outgoing slide.
Same-media content changes must not remount or restart media. Preparation
latency, the configured slide transition, and the short poster-to-video fade
are independent timings.

`DisplayBoxTransitionStage` coordinates audience-visible lifecycle. Media renderers report readiness; they do not independently start or complete crossfades.
