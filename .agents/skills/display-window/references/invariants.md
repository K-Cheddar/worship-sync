# Audience-facing transition invariants

These are hard product rules: keep the current valid visual until its replacement is genuinely ready; never expose a black or empty frame between valid presentation states; and never let stale foreground content reappear after a newer operator request wins.

Do not intentionally fade a live outgoing file video to an incoming poster when the incoming live video can be awaited. Same-media content changes must not remount or restart media. Preparation latency and visual transition duration are separate: transition duration is the real crossfade between ready states. The current 500 ms duration is temporary; future code should resolve it per display and pass it to `DisplayBoxTransitionStage`.

`DisplayBoxTransitionStage` coordinates audience-visible lifecycle. Media renderers report readiness; they do not independently start or complete crossfades.
