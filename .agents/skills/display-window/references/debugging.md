# Video readiness diagnostics

Enable targeted tracing in the affected window devtools:

```js
window.__wsVideoDebug = true
```

`logVideoCue` logs only with that flag. Follow media key and output/window through `transition.requested`, `lane.mount`, `lane.cacheResolved`, `player.mediaReady`, `player.apply`, `play.*`, `player.paintReady`, `transition.animating`, and `transition.complete`. Browser console timestamps supply timing. Do not replace this with always-on production telemetry.
