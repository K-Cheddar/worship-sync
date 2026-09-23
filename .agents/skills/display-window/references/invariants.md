# Audience-facing transition invariants

These are hard product rules: keep the current valid visual until its replacement is genuinely ready; never expose a black or empty frame between valid presentation states; and never let stale foreground content reappear after a newer operator request wins.

Do not intentionally fade a live outgoing file video to an incoming paused
prepared frame when the incoming live video can be awaited. A prepared frame
(`ready-paused`) is sufficient for warm-cache preparation, but a live
video-to-video handoff requires `active-playing`: an advancing frame has been
observed after activation. If the prepared surface cannot reach that state,
the normal fallback renderer may become the replacement instead. Same-media
content changes must not remount or restart media. Preparation latency and
visual transition duration are separate: transition duration is the real
crossfade between ready states. The current 500 ms duration is temporary;
future code should resolve it per display and pass it to
`DisplayBoxTransitionStage`.

`DisplayBoxTransitionStage` coordinates audience-visible lifecycle. Media renderers report readiness; they do not independently start or complete crossfades.
