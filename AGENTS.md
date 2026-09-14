# AGENTS.md

## Repository contract

WorshipSync supports a critical live workflow. Regressions can disrupt a service, confuse an operator under time pressure, or be immediately visible to an audience. Treat every change as live-event software: prioritize safety, clarity, responsiveness, and recovery.

WorshipSync includes:

- A React + TypeScript + Electron client in `client/`
- A Node/Express server at the repository root
- Real-time synchronization across controller, projector, monitor, and stream surfaces
- Media-heavy workflows including video playback, overlays, timers, and multi-window behavior

### Critical invariant: stream transparency

The stream output must always have a transparent background. Do not introduce opaque black or other solid page backgrounds behind stream composition; OBS, browser captures, and other compositors must be able to show content behind it. Projector and monitor may use intentional black stages or bars where product behavior requires them.

## Required workflow

For substantive work—anything affecting behavior, data, contracts, shared rendering, live-operation paths, or more than a localized mechanical edit:

1. Use `$implementation-planning` before editing.
2. Investigate the repository and analogous implementations before designing a solution.
3. Use the relevant specialist skills.
4. Implement the smallest correct solution.
5. Run verification proportional to operational risk.
6. Use `$code-review` for rigorous final review.

The canonical repository skills are in `.agents/skills/`. Skills own detailed procedures; do not copy their detailed rules back into this file. Follow `.agents/engineering-guidance.md` when deciding whether a lesson belongs in enforcement, a skill, or this repository contract.

### Skill routing

- `$react-quality`: substantive React or TypeScript implementation and review.
- `$react-state-performance`: high-frequency, broad-fan-out, synchronized, preview, media, or suspected performance work.
- `$display-window`: projector, monitor, stream, preview, crossfade, media, video, overlay, timer, or display-layer work.
- `/overlay`: overlay state-machine, timing, and Firebase synchronization work.
- `$persisted-mutation-safety` and `$schedule-mutation-safety`: overlapping persisted writes and schedule mutations.
- `/brand-voice`: user-visible copy.

### Assumptions and decisions

Research the repository first; do not ask about routine implementation details that code and existing patterns can answer. Clarify rather than guess when an unresolved decision could materially affect UX, architecture or data ownership, persisted or synchronized shapes, public contracts, backward compatibility, permissions or security, destructive behavior, or scope. Do not silently make consequential product or architecture decisions.

### Before and after behavior

For substantive work, establish before coding and repeat in the handoff:

- Before behavior
- After behavior
- Behavior intentionally unchanged

Cover material UX, contracts, API/network work, persistence and synchronization, Electron/IPC, timing, failures, security, and resource behavior. `$implementation-planning` owns the detailed method. For a behavior-preserving refactor, say so explicitly.

## Prefer the smallest correct solution

Solve the actual problem with the least complexity necessary. Before adding code, consider whether the issue is better addressed by correcting existing logic, removing obsolete logic, consolidating duplicated behavior, deriving state, eliminating competing sources of truth, or simplifying control flow.

Prefer a local correction over a new subsystem; existing state over another source of truth; derived state over synchronized duplicate state; existing components and patterns over parallel implementations; removal over a workaround; and straightforward logic over generalized machinery.

Do not add abstractions, managers, services, hooks, compatibility layers, fallback systems, configuration, extension points, or defensive machinery solely for hypothetical future needs. Introduce an abstraction only when it reduces existing complexity, meaningful duplication, or risk. A small amount of clear duplication is preferable to a premature generalized abstraction.

Keep the change surface narrow. Do not refactor, reorganize, rename, or modernize unrelated code opportunistically unless it is necessary to solve the requested problem or materially reduces the risk or complexity of the required implementation.

### Large localized fixes are a warning signal

For a focused bug or small improvement, roughly 50–100 added lines is a warning threshold, not a hard limit. If the change grows beyond that, explicitly reassess the root cause, code that can be removed or simplified, additional sources of truth, unrequested scope, and premature generalization. If substantial complexity is genuinely necessary, explain why.

Before handoff on a focused fix, be able to explain the root cause, the smallest viable fix considered, code removed or simplified, new complexity introduced, and why any substantial additional complexity was necessary.

## Product and live-workflow safety

Functional correctness alone does not make a user-facing feature complete. Inspect the closest comparable WorshipSync experience before creating UI. Prefer reuse, then composition, then a deliberate variant, and only then a new pattern. When matching an experience, reuse its canonical data source or model as well as its renderer.

Avoid unnecessary page chrome, nested cards, duplicate headers, toolbars, shortcuts, and parallel UI patterns. Live operator interfaces should prioritize clarity, frequent actions, visible safety-critical state, and minimal visual noise. Account for relevant loading, empty, error, interrupted, responsive, permission, and privacy states. Perform a user-perspective acceptance review before reporting user-facing work complete.

Treat shared rendering or state as high risk until demonstrated otherwise. Small changes can affect controller previews, projector, monitor, stream, Electron windows, Firebase synchronization, local persistence, timers, media, overlays, and multi-window behavior. Preserve responsiveness: avoid UI stalls, flicker, dropped frames, delayed input, excessive writes, and cross-window inconsistency.

For stream, preserve transparency and use `$display-window` and `/overlay` for display or overlay work. Do not assume a local fix is isolated from other surfaces or replicas.

## Engineering expectations

Use existing architectural patterns unless there is a clear, evidence-based reason to improve them. Keep public data shapes stable unless an intentional migration changes them; preserve backward compatibility for persisted and synchronized data where feasible. Keep state ownership and synchronization boundaries explicit. New async behavior must be cancellation-safe or interruption-safe where relevant. Prefer graceful degradation for optional integrations.

Use clear names, focused units, straightforward control flow, and comments only when they clarify a non-obvious invariant. Avoid hidden coupling between UI, remote, persisted, derived, and render-only state. For client details—including TypeScript, component, state, testing, and accessibility conventions—use `$react-quality`.

Server changes must preserve client compatibility, validate input, handle errors safely, and account for upload and third-party failure modes without silently changing response shapes.

## Tests and verification

Tests represent behavior contracts. Do not rewrite an existing expectation merely to make the suite green. Before changing one, establish that:

1. Production behavior intentionally changed.
2. The old expectation no longer represents the desired contract.
3. Compatibility, security, operator workflow, and other consumers do not still require the old behavior.

If that cannot be established, fix the implementation or clarify the intended behavior instead of weakening the test. Use focused tests for changed logic and risk-appropriate validation for live display, media, overlay, timer, synchronization, and persistence changes. State verification gaps plainly.

## Completion contract

Before handoff, re-read the request and acceptance criteria; review the complete diff; check callers, consumers, parallel implementations, affected surfaces, edge cases, and failures; and run required risk-appropriate verification.

Never describe work as complete when required implementation or verification remains. `COMPLETE` requires all acceptance criteria implemented, all required affected surfaces addressed, required verification completed successfully, and no known required implementation or verification work remaining. Otherwise report `INCOMPLETE`.

`Not verified (optional)` may contain only unavailable or additional-confidence checks; it must never hide required verification. If Known follow-ups contains work required by the request, the status is `INCOMPLETE`.

Substantive implementation tasks must end with:

```text
Implementation status: COMPLETE | INCOMPLETE

Before behavior
actual behavior before the change

After behavior
actual behavior after the change

Behavior intentionally unchanged
important adjacent behavior preserved

Implemented
concise list

Verified (required)
exact checks run successfully

Not verified (optional)
additional confidence checks not run; no required verification belongs here

Known follow-ups
None or explicit remaining work
```

## Review standards

Review in this order:

1. Correctness and regressions
2. User experience and operator safety
3. Performance and reliability
4. Security and data integrity
5. Simplicity and maintainability
6. Test coverage and verification quality

Review behavior and failure paths, including loading, empty, error, offline, interrupted, transition, and undo/redo states when relevant. Give extra scrutiny to presentation across all surfaces, overlays, media, Electron/browser differences, Firebase or local persistence, window assignment, timers, and mobile layouts.

When asked to review, provide findings first, ordered by severity, with file references and concise risk explanations; then open questions or assumptions; then a brief summary. If no meaningful issue is found, say so and name residual risk or verification gaps.

A change is ready only when it is correct, low-regression, understandable, responsive enough for live use, consistent with product UX, and adequately verified for its risk. When in doubt, protect the live workflow.

## Brand voice

For labels, buttons, toasts, errors, empty states, onboarding, help text, and other user-visible copy, use `/brand-voice`.
review should not treat the change as complete.

When in doubt, favor protecting the live workflow over moving quickly.

## Brand voice

When writing or reviewing user-visible copy — labels, buttons, toasts, errors, empty states, onboarding, help text — use `/brand-voice` for the full voice guide, tone examples, and boundaries.

\***\*Summary:\*\*** Steady, calm, professional casual. No panic language, no theology, no slang. Short sentences. Active voice. Always give a next step on errors.
