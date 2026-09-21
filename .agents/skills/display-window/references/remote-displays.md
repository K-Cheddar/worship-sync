# Stream, remote, and auxiliary displays

Stream output must remain transparent; do not add a black page or stage background. Stream item content, overlays, and local video have intentional layering and timing rules.

Remote/aux displays should use the same normalized state protocol. The prepared
media work described here is local Electron rendering backed by local PouchDB
discovery only; it adds no server manifest, server-side warming, LAN pixel
transport, or remote-window ownership protocol. A future remote preparation
manifest should be normalized by controller scope and media identity before it
is consumed by a display. When aux mirror mode stops, retain the aux
controller's own prior state rather than showing blank or the former mirror
state.
