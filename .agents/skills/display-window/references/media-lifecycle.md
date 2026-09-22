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
pauses, presents that final starting frame before reporting `READY`, and does
not seek again after readiness. `play` waits for the initial playback call and
records the first advancing frame diagnostically; that frame does not gate an
already-ready transition. Reset/reprepare uses generation checks so stale async
work cannot publish readiness for a newer source or identity. A conservative
preparation watchdog releases a wedged pool attempt to the fallback lane.

Opaque persisted references such as `local-video-file://`, `local-image://`, and
`local-video-input://` are resolved before candidate eligibility and before any
HTML media assignment. The pool remains optional: an unavailable or failed
candidate is not a transition gate, and the normal live-file-video fallback
must present its real frame before the transition.

The service-wide preparation input is the resolved outline id for the output's
controller scope. Persisted ItemLists selection is the reload/recovery fallback;
controller selection is also sent immediately through the existing local
renderer broadcast so projector and editor preparation changes without waiting
for persistence. It must not use the church-wide `activeList` for an auxiliary
output. A full transition keeps the outgoing foreground and media intact until
both incoming planes are ready, then uses one coordinated A/B timeline. A ready
pool surface cannot replace an active lane fallback; the transition adopts the
incoming surface explicitly. Adopted ownership is sticky through transient
`READY`/geometry resets, while an active resolved source is frozen until that
ownership ends. The pool is an optimization: all fallback paths remain
authoritative when discovery, cache resolution, decode, or Electron APIs are
unavailable.

The pool exposes development diagnostics for per-surface phase, source kind,
preparation/play-to-frame timing, errors, evictions, and optional renderer CPU /
memory metrics. This phase does not add a server/PouchDB preparation manifest,
LAN pixel streaming, or remote-window ownership protocol.
