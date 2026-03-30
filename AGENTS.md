# AGENTS.md

## Purpose

This file defines review expectations for agents and contributors working in this repository. The goal is to keep changes correct, regression-resistant, performant, maintainable, and polished for real operators during live use.

This repository supports a critical live workflow. Regressions are not minor inconveniences here: they can disrupt a worship service, create operator confusion under time pressure, and be immediately visible to an audience. Reviewers should apply a high bar for safety, clarity, and confidence before approving changes.

## Product Context

Worship Sync is a live presentation application with:

- A React + TypeScript + Electron client in `client/`
- A Node/Express server at the repo root
- Real-time sync across controller, projector, monitor, and stream surfaces
- Media-heavy workflows including video playback, overlays, timers, and multi-window behavior

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

When possible, reviewers should verify relevant commands:

- Root server: `npm run dev` or `npm start` as needed
- Client tests: `cd client && npm test`
- Client lint: `cd client && npm run lint:check`
- Client type/build validation: `cd client && npm run build:strict`

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

Be careful when changing shared display code. A change in one surface may affect:

- Controller previews
- Overlay controller previews
- Projector display
- Monitor display
- Stream display
- Electron windows

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
