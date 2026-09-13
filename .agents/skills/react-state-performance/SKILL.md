---
name: react-state-performance
description: Review and implement React/TypeScript client state when high-frequency updates, broad render fan-out, persisted or synchronized state, preview/display/media paths, meaningful lifecycle or cross-surface effects, or suspected performance problems require deeper analysis.
---

# React State Performance

Use this skill when deeper render and ownership analysis can materially reduce risk. It applies to high-frequency updates, broad render fan-out, persisted or synchronized state, preview/display/media paths, meaningful lifecycle or cross-surface effects, and suspected or measured performance problems.

Do not use it as a mandatory process for ordinary low-risk local component state. Keep optimization evidence-driven: the goal is not to minimize every render, and memoization is not automatically beneficial.

## Workflow

### 1. Classify the update

Before editing, identify:

- **Frequency:** per keystroke, pointer event, animation frame, timer tick, sync event, or occasional user action.
- **Scope:** one control, a component subtree, a page, the whole client, another window, or a remote device.
- **Cost:** simple markup versus filtering, formatting, media work, a large list, or a presentation render.
- **Authority:** transient UI state, draft state, committed local state, persisted state, or remotely synchronized state.

Treat a high-frequency update with broad scope or high cost as a performance-sensitive path. Treat a low-frequency update as lower risk unless it crosses a persistence, synchronization, display, or lifecycle boundary.

### 2. Map ownership and render fan-out

Find where the state is defined, every component that reads it, every writer, and every effect or persistence path it triggers. Inspect provider values, Redux selectors, parent props, list keys, and conditional branches that can cause remounts.

Ask which components must update and which must remain unaffected. A parent rerender can rerender all of its children unless a boundary prevents it; a Context value identity change can notify all consumers; a broad Redux selector can subscribe a component to unrelated fields.

Prefer narrow subscriptions:

- Select the smallest Redux value needed by the component. Prefer primitive fields or narrowly scoped memoized selectors over selecting an entire slice or object.
- Split Context providers by update frequency and concern. Avoid one provider value containing unrelated rapidly changing and stable data.
- Move state down to the nearest common consumer. Lift it only when multiple consumers genuinely need it.
- Split large components at meaningful render boundaries, especially around inputs, large lists, previews, media, and live display output.

Do not restructure solely to eliminate a harmless render. Use the cost and frequency of the affected work to decide whether a boundary is worthwhile.

### 3. Choose the right state location

Keep these local unless they must be shared or persisted:

- Draft text, focus, hover, open/closed state, temporary selection, and local interaction progress.
- Mutable values that do not affect rendering, such as DOM handles, timestamps, cancellation tokens, and the latest callback, in refs where appropriate.

Use Redux, Context, URL state, storage, Firebase, or another shared source only when the state must cross the relevant boundary. Separate a frequently edited draft from a committed or persisted value when doing so avoids unnecessary work and matches product behavior.

Do not use refs to hide state that the UI must render. Do not duplicate derived state merely to avoid a render; derive it during render or memoize the calculation when it is measurably expensive.

### 4. Shape the update path

Use the least expensive correct pattern:

- Keep immediate UI feedback synchronous. Defer or debounce expensive filtering, validation, previews, persistence, and remote work when the behavior allows it.
- Keep input echo separate from expensive results. `useDeferredValue` or `startTransition` can help non-urgent derived UI, but must not delay an operator-critical action or make the field itself feel laggy.
- Use functional state updates when the next value depends on the previous value. Update immutable structures narrowly so unrelated references remain stable.
- Avoid effects that set state derived from other state. This adds an extra render and can create loops or stale intermediate UI; derive the value directly when possible.
- Cancel, ignore, or sequence stale async work. Debouncing a write does not by itself make out-of-order responses safe; pair this skill with the persisted-mutation skills when shared data is involved.
- For rapidly updating visual state, isolate the updating element and consider refs plus `requestAnimationFrame` where the value does not need to drive the entire React tree.
- Keep large lists efficient with stable keys, narrow item props, incremental updates, and virtualization when the rendered size warrants it.
- Keep timers and playback updates local to the display that needs them. Do not make a page-wide state update for a value consumed by one small region.

### 5. Use memoization and boundaries deliberately

Use `React.memo`, `useMemo`, and `useCallback` when they protect a real expensive boundary, stabilize a dependency, or prevent a known high-frequency rerender. Before adding one, identify:

- The update that would otherwise propagate.
- The work the boundary avoids.
- Why the relevant props or dependencies can remain stable.

Do not add memoization everywhere, wrap every handler, or create custom comparison functions without a concrete reason. A memoized child still rerenders when its props change, and unstable object or function props can defeat the boundary. Prefer simpler state placement and component boundaries before layering on memoization.

When using a custom comparison, compare only the actual visual or data contract and keep it cheaper than the render it avoids. Never hide changes needed for correctness just to skip a render.

## Red flags

Investigate these patterns rather than accepting them automatically:

- A top-level page owns draft state used by one small control and a large unrelated tree.
- A component selects or receives an entire state object when it needs one field.
- An inline provider value contains frequently changing and unrelated data.
- Typing triggers persistence, network work, a large preview, or filtering of a large collection synchronously.
- A `useEffect` mirrors props or state into another state variable without a clear external synchronization need.
- A state update recreates arrays, objects, or callbacks passed to many memoized or expensive siblings.
- A changing `key` remounts an input, media element, or expensive subtree during ordinary updates.
- A timer, playback event, or pointer event updates a page-level store even though only one region consumes it.
- A memoization hook is added without an identified avoided render or expensive calculation.

## Verification

For applicable changes, record the intended state owner and the components expected to update. For performance-sensitive paths, verify the interaction at realistic frequency and inspect render behavior with the React Profiler or equivalent targeted measurement when available.

Add or update focused tests for state transitions, debounced or deferred behavior, cancellation, and persistence boundaries when those behaviors change. Tests verify correctness; use profiling or render-count instrumentation only when it provides meaningful evidence for a suspected regression.

Before handoff, check relevant items only:

- Rapid interaction remains responsive and immediate feedback is not unnecessarily deferred.
- Unrelated siblings, large lists, previews, media, and display surfaces do not rerender from a narrow update without a reason.
- Shared state has narrow selectors and correct synchronization semantics.
- Async work is paced and stale results cannot overwrite newer state.
- Memoization and custom comparisons have an explicit reason and do not conceal required updates.
- Relevant lint, focused tests, and client type/build checks have been run.

## WorshipSync integration

Use this skill together with specialized repository skills when applicable:

- Use `$persisted-mutation-safety` for autosave, retries, remote writes, or overlapping client/device mutations.
- Use `$schedule-mutation-safety` for schedule assignment and schedule-map updates.
- Use `$display-window` for projector, monitor, stream, preview, media, overlay, timer, and cross-window rendering paths.

Preserve correctness, live presentation behavior, and cross-window synchronization if an optimization conflicts with them. State the tradeoff and validate the higher-risk path rather than weakening the contract for fewer renders.
