# Transition model and readiness

The coordinator resolves each request as `content` (same background, different foreground), `media` (different background, same foreground), or `full` (both differ). During `preparing`, the outgoing valid visual stays visible.

Box/content paint readiness and general media readiness apply as needed. General file-video readiness may be a poster. Live-video readiness is stricter: after cue/load guards, a decoded video frame has been presented. For a different file-video replacement while the outgoing file video is live or may still be live, the incoming live-video signal is required; local capture does not use this stricter rule.

When a full request has meaningful foreground content and media is delayed,
the stage enters independent plane timing. The foreground starts once its boxes
are paint-ready; media remains in `preparing` and the valid outgoing media stays
visible. A foreground completion leaves the old lane mounted at opacity zero
until the media plane completes, then the incoming lane becomes the sole active
lane. If both planes become ready before animation starts, the stage collapses
back to the coordinated transition behavior.

On interruption, kill the obsolete GSAP timeline, choose a coherent A-or-B baseline, and prepare the latest request. Request generations prevent stale GSAP completion. Do not clear outgoing opacity before React removes that lane: it causes the one-frame stale-lyric flash.
