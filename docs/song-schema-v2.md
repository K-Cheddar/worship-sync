# Song schema v2 conflict boundaries

Schema v2 represents a song as a root document, arrangement documents, and
slide documents. The root's ordered `arrangementIds` list and each arrangement's
ordered `slideIds` list are authoritative. Document IDs use durable song,
arrangement, and slide IDs, so renaming or reordering content does not change
document identity.

## Conflict boundaries

- **Song root:** edits to song-level metadata, links, audio metadata, background
  routing, the selected arrangement, or arrangement ordering can conflict with
  another edit to the same root. The root does not carry slide payloads.
- **Arrangement:** edits to one arrangement's lyrics, song order, monitor layout,
  name, or slide ordering can conflict with another edit to that arrangement.
- **Slide:** each slide document contains all authored state for one slide,
  including its boxes and media presentation data. Edits to different slides
  can sync independently. Two users editing the same slide can still conflict;
  that is expected.

Boxes remain together inside their slide document. There is no automatic
conflict resolution in this foundation stage.

Existing songs continue to be read from their legacy single document, and all
normal song writes remain v1. This document describes the intended v2 contract;
it does not enable migration, fragmented writes, or legacy cleanup.
