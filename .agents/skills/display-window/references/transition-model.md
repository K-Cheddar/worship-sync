# Transition model and readiness

The coordinator resolves each request as `content` (same background, different foreground), `media` (different background, same foreground), or `full` (both differ). During `preparing`, the outgoing valid visual stays visible.

Box/content paint readiness and general media readiness apply as needed. General file-video readiness may be a poster. Live-video readiness is stricter: after cue/load guards, a decoded video frame has been presented. For a different file-video replacement while the outgoing file video is live or may still be live, the incoming live-video signal is required; local capture does not use this stricter rule.

For a full request, the stage keeps both outgoing planes intact while either
incoming boxes or required live media is preparing. Once both are ready, one
coordinated GSAP timeline crossfades foreground and media together. Content-only
and media-only requests retain their specialized plane ownership; full-request
interruption never composes a synthetic foreground/media hybrid.

On interruption, kill the obsolete GSAP timeline, choose a coherent A-or-B baseline, and prepare the latest request. Request generations prevent stale GSAP completion. Do not clear outgoing opacity before React removes that lane: it causes the one-frame stale-lyric flash.
