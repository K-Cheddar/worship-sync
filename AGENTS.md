# AGENTS.md

## Purpose

This file defines review expectations for agents and contributors working in this repository. The goal is to keep changes correct, regression-resistant, performant, maintainable, and polished for real operators during live use.

This repository supports a critical live workflow. Regressions are not minor inconveniences here: they can disrupt a worship service, create operator confusion under time pressure, and be immediately visible to an audience. Reviewers should apply a high bar for safety, clarity, and confidence before approving changes.

## Product Context

WorshipSync is a live presentation application with:

- A React + TypeScript + Electron client in `client/`
- A Node/Express server at the repo root
- Real-time sync across controller, projector, monitor, and stream surfaces
- Media-heavy workflows including video playback, overlays, timers, and multi-window behavior

### Product requirements

- **Stream surface:** The stream output must **always use a transparent background**. Do not add opaque black (or other solid page backgrounds) behind stream composition so OBS, browser captures, or other tools can composite or show content behind it. Projector and monitor surfaces may still use intentional black bars or stages where product behavior calls for them.

Changes should be reviewed with the mindset that this software is used live and mistakes are highly visible.

Treat every change as if it could be exercised during a live event with little time to recover.

## Review Priorities

Review in this order:

1. Correctness and regressions
2. User experience and operator safety
3. Performance and reliability
4. Security and data integrity
5. Maintainability and code quality
6. Test coverage and verification quality

## Non-Negotiables

- This is a mission-critical workflow. We cannot afford avoidable regressions.
- Do not introduce regressions in existing presentation, overlay, timer, media, or sync behavior.
- Prefer the simplest change that fully solves the problem.
- Follow existing architectural patterns unless there is a clear reason to improve them.
- Preserve responsiveness during live operation. Avoid changes that can cause UI stalls, flicker, dropped frames, or delayed input handling.
- Treat controller workflows as high stakes. Operators must be able to understand the state of the system quickly and act confidently.
- Keep cross-window and remote-sync behavior consistent. Local fixes must not silently break projector, monitor, stream, Electron, localStorage, or Firebase-backed flows.
- If a change has meaningful regression risk, require stronger validation rather than relying on assumption.

## What Reviewers Must Check

### 1. Functional correctness

- Does the change do what the ticket or request actually asks for?
- Are edge cases handled?
- Are loading, empty, error, offline, and interrupted states considered?
- Are state transitions correct, especially for `prev*` and current presentation state used for animations and crossfades?
- Are undo/redo expectations preserved where applicable?

### 2. Regression risk

Pay extra attention to:

- Presentation updates across projector, monitor, and stream
- Overlay transitions and timing behavior
- Media playback, caching, fallback behavior, and cleanup
- Electron-only behavior versus browser behavior
- Firebase/localStorage synchronization
- Multi-window state and display assignment
- Timer updates and time-based logic
- Mobile layout versus desktop layout

If a change touches shared rendering paths, assume blast radius is large until proven otherwise.
If a change touches live presentation paths, shared state, sync code, timers, overlays, media, or window management, review it as high-risk by default.

### 3. User experience

Every change should be reviewed for operator clarity and live-use safety:

- Is the UI understandable without guesswork?
- Are labels, actions, and toggles clear?
- Does the interface avoid surprising destructive behavior?
- Are important actions reversible or clearly confirmed?
- Do transitions feel intentional and stable rather than flashy or distracting?
- Are error messages actionable?
- Does the change remain usable on both desktop and mobile when relevant?
- Does it avoid layout shift, visual jitter, or visible flicker?
- Where operator-facing UI is affected, do focus order, keyboard access, labels, and contrast remain sufficient for confident use during a live worship service?

### 4. Performance

Be skeptical of changes that:

- Add unnecessary rerenders in large or frequently updating trees
- Introduce repeated heavy computation in render paths
- Trigger excessive Firebase writes, storage writes, or IPC traffic
- Recreate objects/functions in hot paths without need
- Increase animation, video, or image work in already busy surfaces
- Block the main thread during live preview or display updates

Prefer efficient incremental updates over broad recalculation.

### 5. Maintainability

Expect:

- Clear naming
- Small, focused functions/components
- Minimal duplication
- Straightforward control flow
- Comments only where they add real clarity
- New abstractions only when they reduce complexity

Do not accept speculative abstractions or cleverness that makes live behavior harder to reason about.

**TypeScript**

- Prefer explicit types over `any`. Use `unknown` with narrowing, shared domain types, or `Record<string, unknown>` for loosely shaped JSON when needed.
- For auth API responses, align client types with `authService.js` payloads (see `client/src/api/authTypes.ts`).

### 6. Testing and verification

Changes should include proportional verification.

For critical-path changes, "proportional" means more than a quick skim. Reviewers should expect targeted validation that matches the operational risk of the change.

Expect tests when logic changes in:

- Reducers
- Utilities
- Sync behavior
- Display/rendering branches
- Media handling
- Overlay behavior
- Timer behavior

**Failing tests: intent before rewriting expectations**

A failing test is a signal, not a prompt to silence it. Agents and contributors must not update tests only to make the suite green without establishing that the **production change is intentional** and the **old expectation is obsolete**.

Changing an existing test expectation is a **behavior-change decision**, not a cleanup step. Treat it as a contract review.

Before changing a test to match new behavior:

1. **Confirm intent** — Was the code change deliberate (ticket, PR description, explicit request)? If the failure might be an accident, fix the implementation first.
2. **Confirm the contract** — Does the product or API still require the old behavior (compatibility, security, operator workflow)? If yes, preserve or restore that behavior; do not weaken the test.
3. **If the new behavior is correct** — Update the test to assert the new contract and, when useful, add coverage for edge cases the change introduced.

Required agent workflow before editing an existing test:

1. State in one sentence what behavior changed.
2. State why that change is intentional.
3. Check whether the old behavior was user-visible, operator-critical, API-visible, or relied on elsewhere.
4. Only then update the test expectation.

If an agent cannot complete those steps confidently, it must stop and clarify instead of rewriting the test.

**Heuristic:** If you cannot state in one sentence why the new behavior is correct and the prior test expectation no longer applies, stop and clarify before editing the test.

When a test is updated because the contract truly changed, the agent should also say so explicitly in its summary, review notes, or final response. Do not leave test expectation changes unexplained.

Reviewers should treat unexplained test-only diffs alongside production changes as high risk: they may hide a regression.

When possible, reviewers should verify relevant commands:

- Root server: `npm run dev` or `npm start` as needed
- Client tests: `cd client && npm test`
- Client lint: `cd client && npm run lint:check`
- Client type/build validation: `cd client && npm run build:strict`

**`testing-library/no-node-access`**

- Client lint enforces this rule: **avoid direct Node access; prefer using the methods from Testing Library** (`screen` / `within` / `getBy*` / `findBy*` / `queryBy*`, including `getByRole` with `name` when appropriate). Do not chain DOM traversal APIs on queried elements (for example `closest`, `parentElement`, `querySelector` on a node returned from a query) to reach a parent or sibling; that is what the rule flags.

**`jest/no-conditional-expect`**

- Client lint enforces this rule: **do not call `expect` inside conditional branches** (`if` / `else` / `switch`, ternary callbacks, and similar). Conditionals can skip assertions and make failures harder to interpret. Prefer **partitioning the data first** (for example `filter` into two arrays) and then asserting with top-level `expect` calls, or use a single aggregate assertion (`every` / `some` with a clear predicate) that does not wrap `expect` in a branch.

If full verification is not practical, the review should say exactly what was and was not validated.
If confidence is limited, the review should say so clearly rather than implying the change is safe.

## Repo-Specific Guidance

### Client

Prefer existing patterns already used in the client:

- Redux Toolkit for state changes
- Existing presentation and overlay slice structure
- Existing Electron preload boundary for privileged APIs
- Existing `DisplayWindow` and preview architecture for rendering
- Existing test style with Jest and Testing Library
- Reusable shared UI components (for example `Button`, `Input`, `Select`, and other primitives already in `client/src/components`) instead of ad hoc markup when something suitable already exists

**Operator UI density (live controllers and moderator surfaces)**

Busy operator pages should respect a clear **hierarchy of concern**: default view emphasizes what is used most often during live use (scanning content, frequent actions, sharing links). Less common or higher-impact actions (fine-tuning presentation sizing, clearing all items, starting a new session, bulk resets) belong in a **single, clearly labeled overflow** (for example a **More tools** control opening a panel or menu), with **short in-context helper text** so operators understand scope before acting.

- Keep the primary column **readable**: give the live feed or preview the most vertical space; avoid stacking rarely used toolbars above it when they can live one level deeper.
- **Group** related secondary actions together (for example presentation sizing with session-level resets) so operators do not hunt across the page.
- **Do not hide** safety-critical state (counts, which session is active, connection issues); surface those inline with the feed or header.
- Destructive actions stay **reachable but not prominent**: same overflow group is fine; avoid duplicate destructive entry points unless a live hotspot truly needs a shortcut.
- When using **popovers** or **side sheets** (slide-in panels) for overflow, prefer **sheets** when the content is **tall or scrollable** (several sections, forms, or session pickers); **popovers** stay a good fit for compact, single-column actions. Ensure **keyboard access**, **focus return** to the trigger, **Escape to dismiss**, and **stable labels** for tests (`aria-label` on icon-only or ambiguous controls).

Be careful when changing shared display code. A change in one surface may affect:

- Controller previews
- Overlay controller previews
- Projector display
- Monitor display
- Stream display
- Electron windows

For DisplayWindow-specific work, use `$display-window` before changing or reviewing projector, monitor, stream, preview, crossfade, media background, video playback, or display-layer behavior. This skill captures the current rendering model, known transition pitfalls, stream transparency constraints, and the expected verification checklist.

**Stream overlay behavior**

On the stream surface, overlays are intended to behave as a **temporary top layer**, not as a destructive replacement for the underlying item. The live item layer (slide text, Bible text, or formatted text) should remain available underneath and fade back in after the overlay finishes unless the operator has explicitly hidden stream content.

- Treat the stream as having **one active overlay lane at a time** for participant, stick-to-bottom, QR, image, and board post overlays. Switching overlay types should feel like a handoff, not a hard cut or stacked pile-up.
- Preserve the intent of **current + previous** stream state for transitions. Outgoing overlays may remain briefly only to animate off cleanly; stale prior overlay data must not replay or keep the item layer hidden longer than intended.
- Keep stream transitions **calm and readable**. The stream should favor smooth fade/slide exits and returns over abrupt flashes, flicker, or overly busy animation.
- Do not break the distinction between **overlay activity** and **operator-controlled overlay-only mode**. Automatic overlay display may temporarily hide the item layer, while the explicit stream content toggle should remain a separate, deliberate operator action.

For deep context on the overlay state machine, Firebase sync race conditions, and the checklist for adding new overlay types, use `/overlay`.

### Server

Server changes should be reviewed for:

- Backward compatibility with current client expectations
- Safe error handling
- Input validation
- Failure modes for upload and third-party integrations
- Avoiding silent data shape changes


## Best-Practice Expectations

- Keep public data shapes stable unless the change intentionally migrates them.
- Preserve backward compatibility for persisted and synced state when feasible.
- Use explicit, typed data flow rather than implicit behavior.
- Prefer graceful degradation over hard failure for optional integrations.
- Ensure new async behavior is cancellation-safe or interruption-safe where relevant.
- Avoid hidden coupling between UI state, remote sync state, and derived display state.

## Review Output Format

When asked to perform a review, provide:

1. Findings first, ordered by severity
2. File references and concise explanation of risk
3. Open questions or assumptions
4. Brief summary only after findings

If no meaningful issues are found, say so explicitly and mention any residual risks or verification gaps.

## Approval Standard

A change is ready only when it is:

- Correct
- Low-regression
- Understandable
- Fast enough for live use
- Consistent with existing UX
- Adequately verified for its risk level

If any of those are missing, the review should not treat the change as complete.
When in doubt, favor protecting the live workflow over moving quickly.

## Brand voice

When writing or reviewing user-visible copy — labels, buttons, toasts, errors, empty states, onboarding, help text — use `/brand-voice` for the full voice guide, tone examples, and boundaries.

**Summary:** Steady, calm, professional casual. No panic language, no theology, no slang. Short sentences. Active voice. Always give a next step on errors.
