---
name: implementation-planning
description: Plan substantive WorshipSync implementation work before editing. Use when adding, changing, debugging, or refactoring behavior that could affect users, data, contracts, synchronization, Electron, live displays, or more than a localized mechanical edit.
---

# Implementation Planning

Plan proportionally before editing. Keep small changes concise, but do not skip investigation because a change looks local.

## Workflow

1. Restate the desired user or system outcome.
2. Inspect the relevant implementation before designing a solution.
3. Search for analogous features, helpers, hooks, components, utilities, state patterns, data models, and tests.
4. Define concrete acceptance criteria and the materially changed behavior.
5. Map blast radius: callers and consumers, state ownership, persistence, sync, APIs, Electron/IPC, rendering surfaces, error paths, performance, and security as applicable. Identify the real entry points and runtimes that compose the changed code; include relevant providers/contexts, authentication and permissions, data sources, and browser/Electron/server differences, and compare them with the test harness.
6. For interactive behavior, follow click, open, select, or navigation paths that mount deferred content; do not stop at what renders initially.
7. Complete the **Product Decision Check** before editing behavior-affecting code (details below).
8. Classify remaining unknowns:
   - **A. Repository-answerable technical facts:** investigate what the code does, its callers, constraints, tests, and relevant patterns. This evidence can explain current behavior and inform options; it cannot authorize or settle consequential product intent.
   - **B. Low-impact implementation detail:** resolve using existing patterns and state the assumption when useful.
   - **C. Consequential ambiguity:** ask when a material product or architecture choice remains unresolved. Repository evidence can resolve technical facts and inform tradeoffs, but for product intent it cannot authorize or decide which behavior is intended. Ask when the choice could materially affect behavior/UX, architecture/data ownership, persisted or synced shapes, contracts, compatibility, permissions/security, destructive behavior, or scope.
9. Choose the smallest suitable approach in this order: existing pattern; extension of an existing abstraction; small local solution; new abstraction only when justified.
10. Define required verification that establishes correctness, separately from optional additional-confidence checks. Where test/production composition differences create meaningful risk, require a representative integration-level check using the real entry point or faithful composition; for regressions, preserve the original failure condition in the test when practical. Keep verification proportional to risk.

## Product Decision Check

Before changing observable behavior, data handling, or an operator workflow:

1. Find and read the relevant contract in [`docs/features/`](../../../docs/features/README.md). If none exists, investigate the workflow and adjacent features to understand what happens today and frame the decision. Code, tests, and other repository evidence are not independent authorization for a consequential product choice.
2. Record the feature's purpose, affected operator workflow, and behaviors explicitly confirmed by the request or an applicable product-owner decision.
3. Compare the proposed change with those guarantees. Call out restrictions, automatic behavior, data replacement/preservation/deletion, changed matching/source-of-truth rules, new fallback behavior, and materially different UI or workflow choices.
4. Name the authorization source for each consequential behavior. Authorization comes from the current request, a confirmed applicable contract, or an explicit previous product-owner decision. Record a consequential previous decision in the affected contract, but a clear prior decision does not lose its authority just because it has not yet been written down. Existing implementation, passing tests, and agent-authored documentation do not establish approval. An intentional change to a confirmed contract needs explicit approval and a contract update.
5. If a consequential choice is still open, do not edit the dependent behavior. Ask a concise question with the real options and tradeoffs, recommend only when evidence supports it, and continue independent work that is clearly authorized.

Routine engineering choices and straightforward fixes that restore confirmed behavior remain agent decisions. This checkpoint is not approval for every implementation detail.

Searching for analogous implementations is part of implementation, not optional cleanup.

## Required Output

Use these headings. Keep each section proportional to the change.

### Goal

State the desired user and system outcome.

### Existing architecture

Summarize the relevant implementation, including the analogous patterns found.

### Before behavior

State what the system does today, including non-UI behavior when material.

### After behavior

State what the system should do after the change, including non-UI behavior when material.

### Product Decision Check

Name the applicable Feature Contract or say that none exists; summarize confirmed intent and the affected operator workflow; identify any product behavior changed or introduced and its explicit authorization source. State unresolved consequential choices as specific options with tradeoffs. Mark existing implementation and test expectations as observations, not approval. If a choice blocks the requested behavior change, stop that dependent edit and ask before implementing it.

### Behavior intentionally unchanged

Name adjacent behavior that must remain stable. For a behavior-preserving refactor, say so and describe only the behind-the-scenes difference.

### Acceptance criteria

List observable or contract-level completion criteria.

### Proposed implementation

Describe the selected approach and why it is the smallest appropriate fit.

### Affected surfaces

List impacted consumers and system boundaries, including the production entry point/runtime and relevant providers, authentication, permissions, and data sources; state which do not apply. Note material differences between production composition and test wrappers.

### Risks / edge cases

Cover relevant lifecycle, failure, concurrency, and live-operation cases.

### Questions requiring user input

List only consequential unresolved ambiguities. Write `None` when repository evidence resolves the choices.

### Verification

List the exact required checks, tests, and manual scenarios that establish correctness and distinguish changed behavior from adjacent behavior that must remain stable. Include the interaction path that mounts deferred UI and representative production-context coverage when risk warrants it. For regressions, say whether the test reproduces the pre-fix failure condition. List optional or unavailable additional-confidence checks separately. Required verification that remains undone makes the work incomplete.

## User-facing and operator UX

For user-facing work, inspect the closest comparable WorshipSync experience before inventing UI. Plan reuse of its canonical renderer and data source/model; reuse alone is not parity if data richness or state handling differs. State the intended relationship to the reference, relevant persistent controls, and loading, empty, error, interrupted, responsive, permission, and privacy behavior.

Before calling the work complete, inspect the resulting experience from the user's perspective. Check its hierarchy, data completeness, nearby navigation, responsive behavior, and whether it avoids unnecessary cards, whitespace, duplicated chrome, or parallel patterns.

For dense live controller or moderator surfaces:

- Keep the default view focused on scanning content, frequent actions, and safety-critical state such as active session or connection status.
- Group uncommon or higher-impact controls in one clearly labeled overflow with short scope-setting helper text; keep destructive actions reachable but not prominent.
- Give the primary feed or preview enough space; avoid stacking rarely used toolbars above it.
- Use a sheet for tall or scrollable overflow content and a popover for compact single-column actions.
- Make popovers and sheets keyboard-accessible, dismissible with Escape, and return focus to their trigger. Give icon-only or ambiguous controls stable accessible labels.
