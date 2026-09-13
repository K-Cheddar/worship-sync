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
5. Map blast radius: callers and consumers, state ownership, persistence, sync, APIs, Electron/IPC, rendering surfaces, error paths, performance, and security as applicable.
6. Classify unknowns:
   - **A. Repository-answerable:** investigate before asking the user.
   - **B. Low-impact implementation detail:** resolve using existing patterns and state the assumption when useful.
   - **C. Consequential ambiguity:** stop and ask the user when the choice could materially affect behavior/UX, architecture/data ownership, persisted or synced shapes, contracts, compatibility, permissions/security, destructive behavior, or scope.
7. Choose the smallest suitable approach in this order: existing pattern; extension of an existing abstraction; small local solution; new abstraction only when justified.
8. Define required verification that establishes correctness, separately from optional additional-confidence checks.

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

### Behavior intentionally unchanged

Name adjacent behavior that must remain stable. For a behavior-preserving refactor, say so and describe only the behind-the-scenes difference.

### Acceptance criteria

List observable or contract-level completion criteria.

### Proposed implementation

Describe the selected approach and why it is the smallest appropriate fit.

### Affected surfaces

List impacted consumers and system boundaries, or state that none apply.

### Risks / edge cases

Cover relevant lifecycle, failure, concurrency, and live-operation cases.

### Questions requiring user input

List only consequential unresolved ambiguities. Write `None` when repository evidence resolves the choices.

### Verification

List the exact required checks, tests, and manual scenarios that establish correctness and distinguish changed behavior from adjacent behavior that must remain stable. List optional or unavailable additional-confidence checks separately. Required verification that remains undone makes the work incomplete.
