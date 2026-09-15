# Stale async work on entity changes

## Problem

A request begun for one token, church, service, selection, or route may settle after the operator has changed entity or left the component. Applying that older result can overwrite newer UI, clear a newer error, or leave a timer/listener running.

## Use when

Use this pattern for effects, polling, or asynchronous loading whose result affects component state and whose inputs can change before it settles. Capture the lifecycle boundary, prevent stale commits, and clean up subscriptions/timers.

## Do not use when

Do not add a cancellation flag to a synchronous render calculation or a user-event mutation that does not retain a component-local result. For shared writes, a local cancellation flag does not make persistence safe; use `$persisted-mutation-safety`.

## Canonical WorshipSync examples

- `client/src/pages/InviteAccept.tsx` cancels an invite-preview result when its token changes or the component unmounts.
- `client/src/pages/Controller/CurrentServiceWorkspace.tsx` prevents service-bootstrap and occurrence-hydration results from updating after their lifecycle ends.
- `client/src/pages/Controller/IntegrationsSettingsPanel.tsx` combines a cancellation guard with interval cleanup for connection-status polling.
- `client/src/containers/Toolbar/ToolbarElements/Outlines.tsx` captures the registry needed to create an auxiliary outline, then re-reads the latest registry after `await` before appending. Its scope-keyed in-flight set prevents duplicate bootstrap creation during Strict Mode or remount/re-entry.

Recent history reinforces the need: `21a4d68d` fixed stale video retry listeners after local-video work, and `79a95d38` added a timeout for a hung auth bootstrap so displays do not remain blank.

## Lifecycle and edge cases

- Reset or preserve loading/error state deliberately when the entity changes.
- Guard both successful and failed completion paths.
- Clear intervals, timeouts, subscriptions, and media listeners in cleanup.
- When applying a result changes a collection or entity, re-read the latest authoritative local state after `await`; never merge into a snapshot captured before concurrent remote or local updates could arrive.
- Re-check whether the bootstrap condition is still true after `await`. Use an in-flight guard keyed by the stable entity/scope identity when duplicate setup would be harmful, and release it in `finally`.
- Use `AbortController` where the request supports cancellation and resource savings matter; an active/cancelled flag remains valid when only stale commits need prevention.
- Consider Strict Mode setup/cleanup replay.

## Verification

Use deferred promises or controlled mocks to prove that:

1. An older response cannot overwrite a newer entity's result.
2. Unmount prevents a late result from committing state.
3. Error and loading state belong to the active entity.
4. Polling/listener cleanup prevents further work after the lifecycle ends.
5. A concurrent remote update survives an awaited bootstrap/create result, and remount/re-entry does not create a duplicate for the same identity.
