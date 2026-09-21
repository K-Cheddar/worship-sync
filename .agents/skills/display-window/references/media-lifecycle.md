# Media lifecycle

Electron output renderers now own a bounded, identity-keyed `ElectronMediaSurfacePool`.
It is a renderer-local preparation layer, not a second presentation state or a
pixel transport. The pool is enabled only for Electron output windows with an
output id; browser previews, HLS, local capture, and non-output paths retain the
existing `LaneFullFrameMedia` behavior.

The default budget is eight finite file-video surfaces. Candidates are selected
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

Full transitions with meaningful foreground content can run the foreground and
media planes independently. Ready text may fade while delayed incoming video
remains unselected; the outgoing live video remains visible until the media
plane is ready. If both planes are ready together, the stage preserves the
coordinated A/B transition timeline. The pool is an optimization: all fallback
paths remain authoritative when local discovery, cache resolution, decode, or
Electron APIs are unavailable.

The pool exposes development diagnostics for per-surface phase, source kind,
preparation/play-to-frame timing, errors, evictions, and optional renderer CPU /
memory metrics. This phase does not add a server/PouchDB preparation manifest,
LAN pixel streaming, or remote-window ownership protocol.
