# DisplayWindow transition architecture

`DisplayBoxTransitionStage` owns animated audience-facing projector and monitor slide transitions. It maintains two A/B snapshots. Background/media identity is resolved by `laneBackgroundMedia.ts`; foreground/content identity is derived separately from boxes. The global media plane is below the global content plane, regardless of which A/B lane is active.

`activeLaneId` owns active foreground content. `mediaAnchorLaneId` owns the shared media element during content-only changes, so lyrics can crossfade while a live video or capture node remains mounted. The stage phases are `idle`, `preparing`, and `animating`.

Electron output windows add a renderer-local `ElectronMediaSurfacePool` below
the same media plane. Its identity-keyed surfaces are addressed by media key,
not by A/B lane, so a prepared video survives lane reuse and can be adopted by
the stage without replacing the fallback renderer. The pool is bounded and
optional; it never changes the synchronized presentation snapshot.

For full transitions with meaningful words or labels, `foregroundPhase` and
`mediaPhase` may advance independently. The stage still owns one coherent
baseline and one request generation. A delayed media plane can therefore keep
the old video visible while the new foreground fades in, but interruption kills
both plane timelines and composes the latest visible foreground/media baseline.
