# Equivalent Planning Center regression PDFs

The task attachment contained the request but no original PDFs or API snapshots.
These representative PDFs reproduce the specified baseline and Update 1 and are
generated deterministically by `node server/fixtures/planning-center/generate.mjs`.
They use real PDF text objects; the integration test runs pdfjs, WorshipSync's
text-layout reconstruction, parser and builder, then authenticated save/read
handlers and the server datastore. No reconciliation functions are mocked.

Baseline has the exact eleven requested service items; songs retain the raw
Opening Song, Song and Appeal Song prefixes. Update 1 changes the Prelude note
and duration, David Cole Prayer note and Sermon duration, and adds Ministry
Spotlight immediately before Closing Prayer. Planned anchor: 10:00.

Update 2 is an explicit representative scenario because its original contents
were unavailable: Prelude changes to six minutes, I Surrender All moves before
Scripture Reading, Special Music disappears, two generic Prayer occurrences and
one duplicate David Cole Prayer are added. This exercises real reordering,
removal, identical-title additions and uncertain matching. The test saves local
song notes, a chart, equipment and an operator-created cue before applying it.

The pre-refactor server lifecycle produced exactly 14 operations (3 updates,
1 addition, 10 false moves) and placed all three songs after Closing Prayer.
Current tests require four operations and the exact expected twelve-item order.
