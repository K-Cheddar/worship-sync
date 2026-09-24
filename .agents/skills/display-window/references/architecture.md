# DisplayWindow transition architecture

`DisplayBoxTransitionStage` owns animated audience-facing projector and monitor slide transitions. It maintains two A/B snapshots. Background/media identity is resolved by `laneBackgroundMedia.ts`; foreground/content identity is derived separately from boxes. The global media plane is below the global content plane, regardless of which A/B lane is active.

`activeLaneId` owns active foreground content. `mediaAnchorLaneId` owns the shared media element during content-only changes, so lyrics can crossfade while a live video or capture node remains mounted. The stage phases are `idle`, `preparing`, and `animating`.

Electron output windows add a renderer-local `ElectronMediaSurfacePool` below
the same media plane. Its identity-keyed surfaces are addressed by media key,
not by A/B lane, so a prepared video survives lane reuse and can be adopted by
the stage without replacing the fallback renderer. All pool readiness, element,
and ownership maps use `getLanePreparedMediaKey()` (`remote:...`), never the
lane wrapper identity (`file:remote:...`). A ready surface does not promote an
active fallback; the incoming transition explicitly adopts it, and that owner
persists through content-only changes. The pool is bounded and optional; it
never changes the synchronized presentation snapshot.

Full transitions are coordinated: the outgoing foreground and media remain
intact until the incoming boxes and an acceptable visual (prepared video,
paint-ready poster, or paint-ready fallback video) are ready, then one GSAP
timeline crossfades both planes. Content-only and media-only transitions
retain their specialized shared-plane behavior. Interruption kills the one
timeline and composes the latest coherent A-or-B baseline.

Candidate discovery still enters through the transition stage as a narrow
renderer-local boundary for local fallback rendering. Service-wide discovery and
preparation-manifest publication are owned by the mounted controller lifecycle
(`ControllerMediaPreparationPublisher`), not by this stage. The publisher uses
the canonical `useServiceVideoCandidates` discovery hook for the selected
outline and each assigned output, so it remains active without an output window,
preview role, editor, selected slide, or Electron media pool.

The manifest is stored separately from presentation state at
`churches/{churchId}/data/presentation/mediaPreparation/{outputId}`. It is a
versioned, transport-safe inventory: it contains logical media identities and
HTTP(S) sources, never device-local cache URLs, blobs, or local file references.
Presentation state continues to carry the live/previous slide and playback
position; slide advances and timer ticks do not republish the inventory.

For a mirrored output, the controller resolves the effective source output
before discovery. The destination manifest therefore warms the media required
by the content that audience output actually renders. When mirroring stops, the
same lifecycle publishes the destination controller's independently staged
outline again. Remote Electron windows subscribe to the destination path,
convert entries to local candidates, warm their own cache, and retain the last
valid manifest while reconnecting.
