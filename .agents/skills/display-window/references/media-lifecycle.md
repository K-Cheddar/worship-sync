# Media lifecycle

Electron output renderers now own a bounded, identity-keyed `ElectronMediaSurfacePool`.
It is a renderer-local preparation layer, not a second presentation state or a
pixel transport. The pool is enabled only for Electron output windows with an
output id whose resolved render settings actually paint finite file-video
backgrounds. Browser/stream paths, `showBackground: false` monitor paths, HLS
without a finite cache rendition, and local capture retain the existing
`LaneFullFrameMedia` behavior.

The current default policy is 24 finite file-video surfaces per output
runtime. Candidates are selected
deterministically in this order: current media, videos in the current item,
nearby service items, then remaining service videos. Current A/B transition
identities are protected from normal budget eviction. Duplicate media identities
share one surface, and eviction removes only renderer DOM/playback ownership;
disk-cached bytes are not deleted.

A prepared surface resolves the local/cache source, mounts one persistent video
element, loads metadata, decodes and presents a frame, seeks to the beginning,
pauses, presents that final starting frame, and reports `ready-paused`. This is
preparation readiness, not proof of moving playback. `play` reports
`activation-requested` until an advancing frame is observed; only then is the
surface `active-playing` and safe as the live replacement for a moving video.
Reset/reprepare uses generation checks so stale async work cannot publish
readiness for a newer source or identity. Aborted activation returns to
`ready-paused` when the retained frame is still valid, or resets/reprepares
when a seek invalidated it. A conservative preparation watchdog releases a
wedged pool attempt to the fallback lane.

Opaque persisted references such as `local-video-file://`, `local-image://`, and
`local-video-input://` are resolved before candidate eligibility and before any
HTML media assignment. The pool remains optional: an unavailable or failed
candidate is not a transition gate. For a new selection, a usable prepared
surface wins; otherwise a paint-ready poster can start the slide transition
while that selection's fallback player loads. The coordinator locks the
selected owner at the transition boundary, so a later pool-ready event cannot
promote over an active poster-to-video handoff. The fallback video's
presented-frame signal then drives the existing local poster fade. If no
poster is ready, the fallback video must present a frame before the transition
can start.

The service-wide preparation input is the resolved outline id for the output's
controller scope. Persisted ItemLists selection is the reload/recovery fallback;
controller selection is also sent immediately through the existing local
renderer broadcast so projector and editor preparation changes without waiting
for persistence. It must not use the church-wide `activeList` for an auxiliary
output. A full transition keeps the outgoing foreground and media intact until
incoming boxes and an acceptable visual are ready, then uses one coordinated
A/B timeline. A ready pool surface cannot replace an active lane fallback; the
transition adopts the incoming surface explicitly. Adopted ownership is keyed by `mediaKey` plus
lifecycle generation and remains valid through transient readiness/geometry
updates. Terminal `error` or `disposed` status releases that ownership
immediately so the normal fallback renderer can recover. The resolved source
is frozen when the prepared starting frame is established; remote-to-cache
remapping is diagnostic/source-loading information and does not remount a
valid surface. A newer source waits until ownership is released, unless the
current source fails. The pool is an optimization: all fallback paths remain
authoritative when discovery, cache resolution, decode, or Electron APIs are
unavailable.

The pool exposes development diagnostics for per-surface phase, source kind,
preparation/play-to-frame timing, errors, evictions, and optional renderer CPU /
memory metrics.

Controller routes publish a separate preparation manifest after the canonical
service-media discovery hook has completely loaded the selected outline. The
publisher is mounted for both the main and auxiliary controllers, resolves
controller output ownership and mirrored source output, and uses Firebase only
as a transport for the versioned manifest. It does not cache media locally.
Local Electron output windows still discover and cache from their local PouchDB
and continue to work if manifest publication is unavailable. A paired remote
Electron window has no controller PouchDB or Redux state: it subscribes to its
church/output manifest, converts safe URLs into existing pool candidates, and
warms its own Electron cache. A cached manifest survives a temporary network
loss and is reconciled with the latest state and manifest after reconnecting.

The manifest is preparation metadata, not presentation state. It changes when
the selected outline's structural media composition changes, not on slide
advances, playback positions, or timer ticks. Unsupported versions and
malformed entries are ignored so the normal poster/video fallback remains
authoritative. This architecture does not add LAN pixel streaming, a new video
player, a backend worker, or a change to the 24-surface pool budget.
