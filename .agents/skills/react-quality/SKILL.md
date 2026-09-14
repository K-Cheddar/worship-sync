---
name: react-quality
description: Plan or review substantive WorshipSync React and TypeScript work using the repository's established state, effects, async, typing, UI, and testing patterns. Use for meaningful client behavior or shared implementation; skip trivial visual-only edits.
---

# React Quality

Use this skill for substantive React/TypeScript implementation and review: work that changes client behavior, component state, effects, async loading, a shared hook or utility, types, tests, a cross-window path, or a likely hot render path. Start with `$implementation-planning` and search for analogous WorshipSync code before designing a new mechanism.

Do not use it to turn a one-line copy, class-name, or isolated presentational edit into an architecture review. Escalate only the relevant specialist method:

- `$persisted-mutation-safety` for overlapping shared writes, autosave, retries, and remote echoes.
- `$schedule-mutation-safety` for schedule assignment and slot mutations.
- `$react-state-performance` for high-frequency, broad-fan-out, persisted/synchronized, preview, display, media, or suspected-performance work.
- `$display-window` for projector, monitor, stream, preview, media, overlay, timer, or cross-window rendering.

## WorshipSync baseline

The client uses React 19, TypeScript strict mode, Redux Toolkit slices, focused React contexts, Firebase Realtime Database, PouchDB/browser storage, localStorage, and Electron preload APIs. A state decision can therefore cross local UI, Redux, a local document, Firebase, another browser/device, or an Electron window. Treat those as distinct boundaries.

Before adding code, inspect the relevant slice/context, reader, writer, sync hook, API client, utility, and focused tests. Useful starting points include:

- `client/src/store/store.ts` for Redux listener middleware and guarded Firebase publication.
- `client/src/hooks/useSyncDisplayOutputs.ts` and `client/src/utils/displayOutputsWriter.ts` for synced display registries.
- `client/src/context/controllerInfo.tsx` for PouchDB/controller lifecycle ownership.
- `client/src/components/Button/` and `client/src/components/Input/` for shared control conventions.
- `client/src/test/`, adjacent `*.test.tsx`, and `client/src/components/DisplayWindow/__tests__/` for test style and live-surface contracts.

## Determine ownership before adding state

For every value, write down its current and proposed authority:

| Kind | Question |
| --- | --- |
| Source state | Which component, slice, context, server, or document is authoritative? |
| Derived state | Can it be calculated cheaply from the source during render or by a selector? |
| Render-only state | Is it local animation, focus, DOM handle, timeout, or temporary UI state that must not sync? |
| Cached remote state | What invalidates it, and can an old response replace a newer entity? |
| Persisted state | Which document/API owns it and which writers can overlap? |
| Synchronized state | Which replica is canonical, and how are ordering, remote echoes, and cross-device changes handled? |

Prefer inexpensive render-time derivation to a second state variable. Do not mirror props, Redux state, or remote state into local state merely to make a render branch easier. If a value must be mutable without rendering, use a ref; do not use a ref for UI the operator must see.

Local drafts are a valid exception when an operator needs to edit independently from an incoming source. Define the identity that resets the draft and the policy for remote updates while it is dirty. `client/src/pages/Services/ServicePlanTemplateEditor.tsx` resets a draft only when `template.templateId` changes; `client/src/pages/Teams/schedule/ScheduleEditForm.tsx` preserves an edited draft instead of applying a newer remote baseline. Follow [identity-keyed local drafts](../../patterns/identity-keyed-local-drafts.md) and test meaningful reset behavior.

## Use effects only for external synchronization

Effects synchronize React with an external system. They are not the default mechanism for deriving application state or responding to an operator event.

Before adding an effect, decide whether the work belongs in render-time derivation, an event handler, a reducer/state transition, a selector, initialization, or external-system synchronization. Avoid an effect that sets state derived only from props/state: it adds a render and creates stale intermediate UI.

For a justified effect, inspect all of these:

- Dependencies and stale closures.
- Cleanup for timers, listeners, media, and subscriptions.
- Entity identity changes, unmount, and React Strict Mode remount behavior.
- Overlapping requests and repeated operator actions.
- Loading, empty, error, retry, and partial-failure behavior.

Do not suppress `react-hooks/exhaustive-deps` by default. First restructure the lifecycle so the dependencies are correct. A necessary suppression must state the invariant beside it: for example, `ScheduleEditForm.tsx` documents an identity-only reset and remote-only reconciliation, while `FloatingWindow.tsx` documents registration once per mount. Unexplained suppressions are a review signal. `FormattedTextEditor.tsx` and the generic `useDebouncedEffect.ts` are legacy examples that require deliberate scrutiny before being copied, not canonical templates.

## Make async work entity-safe

An old request must not update a new entity's UI. For each request, listener, poller, or timer, consider unmount, selected ID change, repeated action, stale response, retry, and error clearing.

Use the smallest established pattern that protects the lifecycle. For display-only state, a cancellation/active flag can prevent stale `setState`; `client/src/pages/InviteAccept.tsx` does this when its token changes, and `client/src/pages/Controller/CurrentServiceWorkspace.tsx` does it while service data changes. Use `AbortController` when the API supports cancellation and stopping work is valuable. For shared mutations, cancellation alone is insufficient: route to `$persisted-mutation-safety` and use revision, sequence, transaction, or idempotency semantics as required.

See [stale async work on entity changes](../../patterns/stale-async-entity-changes.md) for the reusable lifecycle and verification model.

## Keep synchronization boundaries explicit

Name canonical, replicated, cached, derived, persisted, and render-only state separately. Never create a second writer just because a component rerendered. Avoid remote writes from render transitions, broad write-then-echo loops, whole-document replacement from stale snapshots, and duplicated persistence paths.

`client/src/store/store.ts` is a canonical example of a synchronization boundary: it filters unchanged presentation fields before Firebase publication and resets the publish cache when the church changes. Preserve those ownership and ordering decisions when extending the path. Do not copy its persistence mechanics into a component; find the existing writer or create a narrowly owned utility only when the behavioral concept is genuinely shared.

## Keep performance evidence-driven

Memoization is a tool for an identified rendering or computation problem, not a quality marker. Do not add `useMemo`, `useCallback`, or `React.memo` by default. For a real hot path, identify the update frequency, subscribers, avoided work, and stable props before adding a boundary.

Use `$react-state-performance` when the change touches timers, live displays, media, previews, large lists, broad subscriptions, sync, or frequent controller updates. It owns detailed selector, render-fan-out, deferral, and profiling analysis.

## Reuse concepts, not syntax

Search before adding a component, hook, helper, formatter, API wrapper, state mechanism, or persistence mechanism. Prefer shared primitives when they fit: operator controls use the repository's `Button`, `Input`, `Select`, and related components with accessible names and `cursor-pointer` for enabled custom controls.

Two similar snippets do not automatically justify an abstraction. Extract only when callers share the same behavioral concept, lifecycle, and error semantics; otherwise keep a clear local implementation.

## Type for real boundaries

Classify `any` and assertions before changing them:

- Interoperability necessity: isolate the untyped boundary and narrow immediately.
- Legacy debt: do not spread it into new code.
- Easy stronger-typing opportunity: use a local domain type, `unknown` plus narrowing, or an accurate partial/mock type.
- Architectural typing problem: model the API/document/IPC boundary before adding more assertions.

Prefer domain types, accurate API payloads, narrowing of unknown data, and discriminated unions where they reflect actual states. Do not require elaborate types for trivial data. Existing `as any` in PouchDB document filtering (`client/src/utils/dbUtils.ts`) and broad context typing (`client/src/context/controllerInfo.tsx`) are debt/interoperability boundaries, not permission to use `any` as the easiest escape hatch.

## Test contracts, including lifecycles

Use Testing Library's accessible queries and `user-event` for operator interactions. Put reducer and utility contracts in focused tests; add lifecycle tests for state reset, request cancellation, timers/listeners, async errors, and synchronization whenever that behavior changes. Live display changes also need the surface-specific tests required by `$display-window`.

Ask: could this test pass while the user-visible or cross-device behavior is broken? If so, it may be coupled to implementation details or lack a negative/lifecycle assertion. Do not weaken an existing expectation until the production behavior and old contract have been reviewed under `AGENTS.md`.

## Review and verification

Record the intended state owner, effect purpose, async stale-response policy, and expected render scope when they matter. Re-read callers, consumers, parallel implementations, and affected tests before handoff.

Run the narrowest focused tests plus client lint and the applicable type/build command. `npm.cmd run type-check --prefix client` is valuable diagnostic evidence but is not currently a clean gate; see the [enforcement assessment](references/enforcement-assessment.md). Keep required verification separate from optional confidence checks.
