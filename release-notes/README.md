# User-facing release notes

Add or update a release-note fragment when a change gives users a meaningful new capability, improves a workflow, changes visible behavior, fixes a bug users may have encountered, or improves reliability or performance in a way users will notice.

Do not add notes for tests, refactors, code cleanup, CI or build changes, dependency updates, implementation details, or internal data and schema work with no meaningful visible effect.

Write about the outcome for users, not how the code works. For example, say “Media changes now stay in sync more reliably across controllers and devices,” rather than “Normalize media library persistence.” When several commits contribute to one product improvement, prefer one useful note instead of exposing each implementation step. If a recent fragment already covers the same improvement, update it rather than creating a duplicate.

Create one descriptive, collision-resistant `.json` fragment per meaningful product change. Each fragment must have a stable unique `id`, an ISO `YYYY-MM-DD` release date, a `type` of `new`, `improved`, or `fixed`, a short product-oriented `title`, and a concise `description`. Use `$brand-voice` for the copy.
