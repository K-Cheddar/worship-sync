# Media lifecycle

Electron output renderers now own a bounded, identity-keyed `ElectronMediaSurfacePool`.
It is a renderer-local preparation layer, not a second presentation state or a
pixel transport. The pool is enabled only for Electron output windows with an
output id whose resolved render settings actually paint finite file-video
backgrounds. Browser/stream paths, `showBackground: false` monitor paths, HLS
without a finite cache rendition, and local capture retain the existing
`LaneFullFrameMedia` behavior.

The provisional default policy is ten finite file-video surfaces per output
runtime. Candidates are selected
deterministically in this order: current media, videos in the current item,
nearby service items, then remaining service videos. Current A/B transition
identities are protected from normal budget eviction. Duplicate media identities
share one surface, and eviction removes only renderer DOM/playback ownership;
disk-cached bytes are not deleted.

A prepared surface resolves the local/cache source, mounts one persistent video
element, loads metadata, decodes and presents a frame, seeks to the beginning,
pauses, and reports `READY`. `play` performs any cue seek and waits for a
presented frame before reporting live readiness. Reset/reprepare uses generation
checks so stale async work cannot publish readiness for a newer source or
identity.

The service-wide preparation input is the resolved outline id for the output's
controller scope, read from local PouchDB. It must not use the church-wide
`activeList` for an auxiliary output. A full transition keeps the outgoing
foreground and media intact until both incoming planes are ready, then uses one
coordinated A/B timeline. A ready pool surface cannot replace an active lane
fallback; the transition adopts the incoming surface explicitly, and the
adopted owner remains in use through content-only changes. The pool is an
optimization: all fallback paths remain authoritative when discovery, cache
resolution, decode, or Electron APIs are unavailable.

The pool exposes development diagnostics for per-surface phase, source kind,
preparation/play-to-frame timing, errors, evictions, and optional renderer CPU /
memory metrics. This phase does not add a server/PouchDB preparation manifest,
LAN pixel streaming, or remote-window ownership protocol.
