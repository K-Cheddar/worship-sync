# Transition model and readiness

The coordinator resolves each request as `content` (same background, different foreground), `media` (different background, same foreground), or `full` (both differ). During `preparing`, the outgoing valid visual stays visible.

Box/content paint readiness and general media readiness apply as needed. A
file-video replacement is ready when an identity-matched prepared surface is
usable, its poster has painted, or its fallback video has presented a frame.
When a ready poster is selected, the stage commits to the fallback player for
that transition; a pool surface that becomes ready later is reserved for a
future selection. If neither video nor poster is ready, the outgoing visual
stays intact. Local capture keeps its existing paint-readiness contract.

For a full request, the stage keeps both outgoing planes intact while either
incoming boxes or an acceptable incoming visual is preparing. Once both are ready, one
coordinated GSAP timeline crossfades foreground and media together. Content-only
and media-only requests retain their specialized plane ownership; full-request
interruption never composes a synthetic foreground/media hybrid.

On interruption, kill the obsolete GSAP timeline, choose a coherent A-or-B
baseline, and prepare the latest request. Request generations prevent stale
GSAP completion. A later video frame only reveals video beneath the selected
poster; it never restarts the foreground transition. Do not clear outgoing
opacity before React removes that lane: it causes the one-frame stale-lyric
flash.
