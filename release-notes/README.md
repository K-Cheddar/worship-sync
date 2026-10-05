# User-facing release notes

Release notes describe product-level capabilities and meaningful user outcomes, not every user-visible code change. Add or update a fragment when users gain a distinct capability, workflow improvement, or meaningful fix for a problem they may recognize. A change being technically user-visible is not enough by itself.

Group related implementation work into one product-level note. Do not expose implementation sequencing or create one note per commit. If a feature has not shipped yet and later work fixes, polishes, or completes it, update its existing feature note so it describes the finished behavior that will ship. For example, paused playback and seeking refinements belong in the unreleased rehearsal playback note, not in separate fix notes.

Do not create notes for tiny polish changes, incidental UI adjustments, internal consistency changes, fixes to an unreleased feature already covered by another note, or changes to What's New itself unless they materially improve discovery or understanding of product updates. Continue to exclude tests, refactors, code cleanup, CI or build changes, dependency updates, implementation details, and internal data or schema work without a meaningful visible effect.

Write about the outcome for users, not how the code works. For example, say “Media changes now stay in sync more reliably across controllers and devices,” rather than “Normalize media library persistence.” If a recent unreleased fragment already represents the product improvement, update it rather than creating a duplicate.

Create one descriptive, collision-resistant `.json` fragment per meaningful product change. Each fragment must have a stable unique `id`, an ISO `YYYY-MM-DD` `date`, a `type` of `new`, `improved`, or `fixed`, a short product-oriented `title`, and a concise `description`. Use `$brand-voice` for the copy.

`date` is the product update date, or expected release grouping date. While developing, use the expected product update date. Before release, staging or release review should correct dates if deployment has moved. Do not add semantic-version coupling or release-time automation just to populate this field.
