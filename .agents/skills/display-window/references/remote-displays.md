# Stream, remote, and auxiliary displays

Stream output must remain transparent; do not add a black page or stage background. Stream item content, overlays, and local video have intentional layering and timing rules.

Remote/aux displays use the same normalized presentation-state protocol, with
preparation metadata kept separate from the live slide snapshot.

Controller ownership and output scope

- `ControllerMediaPreparationPublisher` is mounted by the main and auxiliary
  controller routes. It resolves the controller's assigned push outputs and
  selected outline scope, then reuses `useServiceVideoCandidates` to publish
  each output's structural media inventory.
- A mirrored output resolves its effective source output before discovery. Its
  manifest contains the source outline's media while the destination output ID
  remains the subscription key. Stopping mirroring causes the destination's
  independently staged outline to be published again.
- Presentation state remains under
  `churches/{churchId}/data/presentation/{key}`. Preparation manifests are
  under `churches/{churchId}/data/presentation/mediaPreparation/{outputId}`.
  The two streams are reconciled independently; a slide advance does not
  republish the service inventory.

Remote Electron preparation

A paired display receives its church and assigned output from the pairing
bootstrap. It does not use the controller's PouchDB, filesystem, Redux state,
or cache URLs. It subscribes to the output-scoped manifest, validates the
versioned transport-neutral payload, converts logical entries to the existing
`ElectronMediaSurfacePool` candidates, and warms its own finite media cache.
Prepared video transitions directly to the prepared surface. If preparation is
late or fails, a ready poster starts the ordinary transition immediately and
the fallback video fades in after its first valid frame. With no manifest yet,
the normal local fallback path still renders the current presentation state.

During a temporary network loss, the remote renderer keeps its last valid
manifest and visual. On reconnect it accepts only newer valid presentation
state and manifest revisions, then warms the current candidates without a
reload. Church/output identity changes clear renderer-local preparation state
before the new subscription is used, preventing cross-church media retention.

The display client is read-only for shared presentation data. The pairing
token includes the church and assigned output claims for deployment rules to
enforce; this checkout contains no Realtime Database rules file, so deployed
Firebase rules must be verified separately before claiming production
authorization isolation. Do not add LAN pixel transport or remote screen
capture.

Aux mirroring keeps both TransmitHandler previews: Main Projector is read-only,
while TVs shows its resolved audience presentation. The independent staged TVs
preview and LIVE/STAGED distinction remain local operator state. “Following
Projector” describes the relationship; a synchronization badge requires actual
output-side evidence.
