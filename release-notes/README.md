# User-facing release notes

Release notes are a curated product update feed, not a friendly changelog. Describe product-level capabilities and meaningful outcomes users will notice, not every user-visible code change.

## Decide whether to add a note

Before creating a **new** fragment, ask:

> Would this change deserve one of roughly 5–8 items in a release summary for a normal WorshipSync user?

This is a heuristic, not a hard limit. A new note should generally represent a recognizable new capability, substantial workflow improvement, important reliability improvement, or meaningful fix to a problem users may have experienced.

Use this order:

1. Update an existing unreleased product note if the work belongs to that concept.
2. Add no release note if the work does not materially change the product story.
3. Create a new fragment only when it represents a distinct product-level outcome.

Creating a new fragment should be the least common choice. Tiny polish, layout refinement, incidental UI behavior, narrow edge-case correction, or a fix to an unreleased feature normally does not justify a new fragment. Do not create notes for tests, refactors, code cleanup, CI or build changes, dependency updates, implementation details, or internal data and schema work without a meaningful visible effect.

## Group related work

A release note must represent **one coherent product concept**. Do not combine unrelated small fixes just because they were implemented or committed together. For example, “Keep selected share names and icon colors” combines unrelated fixes; each would need to clear the threshold on its own or be omitted. Avoid vague catch-all notes whose only connection is that several dialogs, buttons, or screens changed.

If a feature or workflow has not shipped yet, its fixes and refinements are part of the finished feature. Update the existing unreleased note only when the work materially changes what users will experience. Do not create standalone `fixed` notes for bugs users could never have encountered in production or enumerate development-stage corrections. For example, persistent rehearsal playback, paused seeking, and minimized controls belong in one **Rehearsal playback — New** note.

## Write concise descriptions

Descriptions should normally be one sentence; roughly 35 words or fewer is a useful target. Describe the resulting user outcome, not every behavior changed to achieve it. Follow-up work should change a description only when it materially changes that outcome. If a note has accumulated clauses about minor fixes, simplify it back to the product-level result. Do not split an overly long note into several notes for insignificant details.

Use `$brand-voice` for the copy. Prefer clear, direct language users recognize. For example, say “Media changes now stay in sync more reliably across controllers and devices,” rather than “Normalize media library persistence.”

## Prepare a release candidate

Before preparing staging or `master` for a release:

1. Compare the release candidate with the current `master` or last shipped release to identify the complete set of unreleased product changes.
2. Curate those changes against the decision test above: update notes for shared concepts, omit work that does not qualify, and create only notes for distinct product-level outcomes.
3. Set the curated notes for this release to the same expected product update date. This keeps one release cycle grouped under one date, so the initially expanded date does not emphasize late development fixes over earlier headline features. If the release date changes, update the group date during release review.
4. Read the feed as a normal user. Check that each note stands on its own, describes one outcome, and stays concise; remove any note that does not earn its place in the release summary.

## Fragment format and dates

Create one descriptive, collision-resistant `.json` fragment per meaningful product outcome. Each fragment must have a stable unique `id`, an ISO `YYYY-MM-DD` `date`, a `type` of `new`, `improved`, or `fixed`, a short product-oriented `title`, and a concise `description`.

While developing, use the expected product update or release grouping date, not the individual development date. During pre-release curation, align the batch to the release's expected date and correct it if deployment moves. Do not add semantic-version coupling or release-time automation just to populate this field.
