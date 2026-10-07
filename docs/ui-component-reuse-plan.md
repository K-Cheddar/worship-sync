# UI component reuse plan

## Goal
Establish browser/Radix primitives → `components/ui` → app-facing controls → domain compositions → pages, using the clean `in-progress` checkout.

## Existing architecture
Button, Input, TextArea, Checkbox, Toggle and Select already wrap UI primitives. Modal duplicates the styled UI dialog shell and imports Radix directly. RadioButton also imports Radix. Select already groups ReactNode options and supports controlled opening, but lacks rich selected values and textValue. Feature code bypasses wrappers for mixed checkbox state and externally labelled switches.

## Before behavior
Confirmation and lightbox implementations differ in focus/dismissal behavior; guest removal uses the browser confirmation. Most wrapper callers already share styling and mobile sizing.

## After behavior
Modal owns the single app dialog layout and composes owner-aware UI primitives. ConfirmDialog shares confirmation actions and busy dismissal protection. Wrapper APIs cover the identified caller gaps; ordinary feature usages migrate incrementally. Import restrictions protect the boundaries.

## Behavior intentionally unchanged
This is a behavior-preserving refactor except for accessible in-app guest confirmation, focus/dismissal consistency and explicit busy protection. Preserve domain content, actions, permissions, persistence, synchronization, selection/clear semantics, controller interactions, mobile targets and floating-window hosts. Presentation rendering and stream transparency are unchanged.

## Acceptance criteria
Cover all eight requested families; migrate the named ordinary usages; preserve rich/selectable and specialized controls; document individually audited native/primitive exceptions; pass type checking, lint and focused affected tests.

## Proposed implementation
Keep existing app-facing names, extend APIs and compose existing primitives. Add ConfirmDialog for shared actions. Clarify PopOver as PopoverPanel and remove unused MenuItem. Keep segmented time inputs and other specialized native controls. Avoid a field-shell abstraction unless inspection shows a net simplification (the current wrappers have materially different field behavior).

## Affected surfaces
Teams/Schedule, Services, account/install help, chat lightbox, controller controls, portable imports and floating-window overlays. No server, IPC, persisted schema or synchronization changes.

## Risks / edge cases
Dialog stacking, keyboard focus and restoration, busy dismissal, nested portals; rich-select typeahead and empty values; boolean callback compatibility with mixed checkbox state; guest confirmation cancellation on schedule identity change/unmount; asynchronous lightbox completion after identity changes.

## Questions requiring user input
None. Existing behavior and the request resolve the implementation choices.

## Verification
Run focused tests after each family, including dialog focus/stacking/busy behavior, rich selects, checkbox/Toggle/Radio, guest cancellation, chat, portable imports, Teams/Schedule and affected Controller consumers. Run client type-check, lint:check and strict build; re-audit imports and native fields. Browser/Electron visual acceptance is additional confidence if an interactive app is unavailable.
