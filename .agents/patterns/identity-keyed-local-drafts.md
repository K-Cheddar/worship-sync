# Identity-keyed local drafts

## Problem

An editor needs a local draft so an operator can make several changes before committing them, but its source entity can change through navigation or sync. Blindly mirroring every new object into local state discards edits; never resetting leaks one entity's draft into another.

## Use when

Use this pattern for a real local draft whose source identity can change and where the reset policy matters to operator work. Define the identity key first, initialize/reset from that key, and specify whether a remote update may replace a clean or dirty draft.

## Do not use when

Do not use it for a value that can be derived during render, an immediate controlled field with no independent draft, or a shared/persisted write that needs the mutation-safety workflow.

## Canonical WorshipSync examples

- `client/src/pages/Services/ServicePlanTemplateEditor.tsx` resets its draft history only when `template.templateId` changes, not when a new object reference arrives.
- `client/src/pages/Teams/schedule/ScheduleEditForm.tsx` resets for the active schedule identity and only applies an incoming persisted draft when the operator's draft still matches its synchronized baseline.

## Lifecycle and edge cases

- Treat identity change, not object identity, as the reset signal.
- Make new, missing, and deleted entity behavior explicit.
- Preserve dirty local work when that is the operator contract; do not let a remote echo wipe it.
- Avoid a reset effect whose broad dependencies make ordinary sync/list updates reset the form.
- Use `$persisted-mutation-safety` or `$schedule-mutation-safety` when a draft save can overlap with another writer.

## Verification

Test at least the meaningful paths for the feature:

1. A new identity starts with that entity's source draft.
2. A source object refresh for the same identity does not unexpectedly discard unsaved work.
3. Switching identity does not retain the previous entity's draft.
4. Remote reconciliation follows the stated dirty/clean policy.
