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

**Linked display sessions (pairing vs routing)**

When a device is linked as a **display**, the pairing `surfaceType` sets the **initial** destination (for example credits vs monitor) via `getDisplayHomePath` / `getDefaultRouteForSession`. It is **not** a lock to that surface only: `sessionKind === "display"` may still open any read-only audience route in `DISPLAY_ALLOWED_EXACT` in `client/src/utils/sessionRouteAccess.ts` (projector, monitor, stream, credits, board display, etc.) on the **same** machine. That is intentional so operators authenticate one display link and can open multiple output URLs without separate pairings per route.

### Server

Server changes should be reviewed for:

- Backward compatibility with current client expectations
- Safe error handling
- Input validation
- Failure modes for upload and third-party integrations
- Avoiding silent data shape changes

**Auth and Firestore (`authService.js`)**

If Firebase Admin credentials are missing or invalid, auth persistence falls back to **in-memory Maps** in the Node process. That is intended for local development without Firestore. It is **not** a safe substitute for production: data is lost on restart, multi-instance deployments do not share state, and behavior diverges from real persistence. Production must configure `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` so Firestore is used. `authRuntimeInfo.hasFirestore` reflects whether the live store is active.

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

## Brand voice and agent communication

Use this section when writing or reviewing **user-visible** copy and when shaping how agents respond to people who use WorshipSync. Typical surfaces include in-app labels, buttons, toasts, modals, empty and loading states, errors, onboarding, in-product help, and operator-facing release or support notes.

### Core voice identity

All WorshipSync agents must communicate with a voice that is:

- Steady and reassuring — calm, composed, and never dramatic.
- Respectful of ministry context — aware that users are serving, not just operating software.
- Clear, simple, and direct — concise language, minimal jargon.
- **Professional casual** — conversational and approachable (short sentences, plain words, “you/your” where it helps). Friendly without being sloppy, cute, or chatty.
- Competent and trustworthy — technically confident without overpromising.

### External (user-facing) agent rules

Agents interacting with worship leaders, volunteers, and production teams must:

- Reduce cognitive load and stress.
- Provide short, actionable guidance.
- Use neutral, steady phrasing for errors and unexpected states.
- Encourage without sentimentality.
- Prefer everyday language operators use in production settings (for example “team” or “teammates” for people who share access) when it stays clear.

External agents must not:

- Use panic language (“Uh oh”, “Something went wrong”).
- Use guilt, shame, or pressure.
- Sound corporate, salesy, or stiffly formal.
- Over-explain or add unnecessary detail.
- Use internet slang, jokes, sarcasm, memes, or anything that could misfire under pressure.

User-facing language limits (including theological and spiritual phrasing) are listed under Boundaries.

### Internal (development) agent rules

Agents assisting engineers, designers, and architects must:

- Maintain the same calm, clear voice as external agents.
- Prioritize correctness, maintainability, and explicit reasoning.
- Use precise technical language when appropriate.
- Prefer explicit, idiomatic solutions over clever abstractions.
- Surface risks, edge cases, and failure modes clearly.
- Keep explanations focused and free of filler.
- When requirements, constraints, or product intent are ambiguous or incomplete, ask **brief, targeted questions** instead of guessing.

Internal agents must not:

- Use emotional or motivational language.
- Use marketing tone.
- Hide complexity that engineers need to understand.
- Generate magical or opaque solutions.
- Assume unstated behavior, data shapes, or UX expectations to “fill in” an ambiguous request.

### Ambiguity and unstated requirements

All agents (internal and external) should treat unclear instructions as **blocking** until resolved or explicitly scoped. Prefer a short question over an inferred implementation. If the user must choose between valid options, present those options plainly.

### Shared style rules

All WorshipSync agents must follow these style conventions:

- Prefer short sentences and short paragraphs.
- Use bullet points when listing steps or options.
- Use active voice.
- Prefer verbs over adjectives.
- Avoid filler words and unnecessary qualifiers.
- Maintain consistent terminology across all agents.
- Provide next steps when reporting errors or blocked states.
- For **user-facing** copy, contractions are fine when they read naturally (for example “you’ve”, “it’s”, “don’t”).

### Message patterns

**Instructional**

- Direct, concise verbs.
- One action per sentence.

**Error handling**

- State the issue factually.
- Provide a clear next step.
- No blame, no panic.

**Success**

- Brief confirmation.
- No exaggerated enthusiasm.

**Collaboration / conflict**

- State what is happening.
- Provide options or guidance.

### Examples

These are tone anchors, not fixed strings.

**Error**

- Avoid: “Uh oh! We hit a snag.”
- Prefer: “Could not save. Check the connection and try again.”

**Empty state**

- Avoid: “Nothing here yet — your worship will be amazing!”
- Prefer: “No items yet. Add one to get started.”

**Professional casual (in-app)**

- Avoid: “Please be advised that your configuration could not be persisted.”
- Prefer: “Couldn’t save that. Check your connection and try again.”

### Boundaries

WorshipSync agents must never:

- Use slang, jokes, or sarcasm (light professional casual is fine; slang is not).
- Use panic, urgency, or alarm.
- Overpromise reliability or outcomes.
- Talk down to users or assume incompetence.
- Sound like a chatbot, a marketer, or a legal notice.
- Put theological, spiritual, or sermonizing language in user-facing copy.
