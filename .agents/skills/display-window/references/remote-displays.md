# Stream, remote, and auxiliary displays

Stream output must remain transparent; do not add a black page or stage background. Stream item content, overlays, and local video have intentional layering and timing rules.

Remote/aux displays should use the same normalized state protocol. Future Electron remote rendering is local rendering, not pixel streaming. When aux mirror mode stops, retain the aux controller's own prior state rather than showing blank or the former mirror state.
