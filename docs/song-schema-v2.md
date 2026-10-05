# Song schema v2 conflict boundaries

Schema v2 represents a song as a root document, arrangement documents, and
slide documents. The root's ordered `arrangementIds` list and each arrangement's
ordered `slideIds` list are authoritative. Document IDs use durable song,
arrangement, and slide IDs, so renaming or reordering content does not change
document identity.

## Document and read contract

V2 database documents use `docType` as their discriminator: `song-v2-root`,
`song-v2-arrangement`, and `song-v2-slide`. A v2 root must not contain the
legacy item discriminator `type: "song"`; legacy library and maintenance scans
use that field to identify complete v1 song documents. Hydrating a v2 root
creates an application-facing song with `type: "song"` while retaining the
root `docType` as its storage-version marker.

Presence of a v2 root currently enables v2 reads. V2 mutation remains
intentionally disabled: save and delete operations on a v2-backed song fail
with an internal repository error until the v2 write engine is implemented.
Do not create real v2 documents in normal application flows before write
support lands; migration, shadow roots, and dual writes are not enabled.

The legacy song `_rev` and v2 root `_rev` belong to different physical
documents. They must never be mixed: in particular, a v2 root revision cannot
be used when writing the legacy document with the song's original ID.

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

Songs without a v2 root continue to be read from their legacy single document,
and all normal song writes remain v1. This document describes the v2 contract;
it does not enable migration, fragmented writes, or legacy cleanup.
