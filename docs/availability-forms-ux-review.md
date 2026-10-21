# Availability forms UX workflow review

## Findings
Critical: None. High: None. Medium: None. Low: None remaining.

The review found and corrected two lifecycle issues in the affected paths: late link results could publish to a different selected workspace, and a recreated recipient could temporarily inherit an older cached response projection. Owner/form guards and response timestamp/recipient matching now prevent those results.

## Product authorization status
Authorized by the 2026-10-21 redesign request and the confirmed availability SMS contract: full-width detail workspace, exactly two tabs, row actions, single selection/review dialog, explicit send confirmation, responsive responses, and existing permission boundaries. No new persisted schema, dispatch mechanism, resend override, or My Schedule credential behavior.

## Open questions / assumptions
None. Export and archive were not existing form actions and have not been introduced. Form open/closed settings remain available through Edit. General form links still require broad Teams edit permission; scoped editors receive personal-link actions only.

## Verification gaps
Scope: workflow review, not a release-wide production-readiness review.

Production-context verification: Pass. `TeamsFormsPage.workspace.test.tsx` mounts the real Forms page, manager, workspace and deferred response UI under the router, global identity, toast and navigation guard composition. It covers administrator bootstrap/submission records and scoped REST availability responses, including explicit refresh after submission. Existing page tests cover team/range filtering; shared Messages tests exercise the unchanged advanced consumer. The browser fixture mounts the real workspace, tabs, menus and dialog primitives with actual app CSS at 1280px and 375px. It verifies no page overflow, responsive matrix/card visibility, expansion, one dialog, cancel, and absence of browser errors; screenshots were visually inspected.

| Invariant | Adversarial scenario | Code evidence | Test evidence | Result |
| --- | --- | --- | --- | --- |
| Explicit approval | Prepare, Back, adjust filters, review again, final Send; cancel prepared review | Existing review/selection identities, approval version and dispatch lock in AvailabilityFormSendFlow; dialog changes presentation only | Dialog filter/Back/final-send and cancellation tests; rapid confirmation test | Pass |
| No accidental retries | Accepted-but-undelivered or uncertain attempt; definitive failure mixed with first-time recipients | Unchanged getAvailabilityRecipientRows and batch action API | Recipient selection tests and explicit-failure-selection send-flow test | Pass |
| Fresh history | Older load resolves after a newer open; history refresh fails | IntakeManager refresh sequence plus church/form/mount guards; selection requires historyLoaded | Reopen/older-response, unmount/error and complete paginated history tests | Pass |
| Entity ownership | Personal link pending; navigate to another form; old result resolves | Captured church and recipient.formId checked before callbacks/clipboard | Controlled pending personal-link test in IntakeManager.test.tsx | Pass |
| Response validity | Revoke/recreate same recipient ID while old projected answer remains cached | Progress derivation requires matching current recipient timestamp and member; administrator answers use submissionId, never name | Recreated-link projection and recipient-linked submission tests | Pass |
| Restricted projections | Scoped editor opens details, refreshes responses, or opens review | Existing restricted endpoint and privacySafe flag; no general-link action; applicableMembers limits rows to form scope | Scoped page integration, read-only/scope manager test and privacy-safe send-flow test | Pass |

Checks: ten focused Jest suites passed (103 tests in the combined run); final modified manager/progress suites passed again (37 tests, including one added stale-projection regression). The final administrator/scoped page integration suites also passed after the lifecycle guards changed. Final TypeScript passed. Desktop/mobile browser checks passed. `npm.cmd run build:strict --prefix client` passed, including zero-warning lint; Vite emitted CSS URL/minification and large-chunk build warnings unrelated to this workflow. `git diff --check` passed.

The sandboxed standard build could not resolve the config because ancestor-directory access was denied; runner mode then encountered the existing config's `__dirname` usage. The normal strict build succeeded with approved execution outside that sandbox. No build configuration was changed.

Exact Jest scope: `IntakeManager.test.tsx`, `TeamsFormsPage.workspace.test.tsx`, `TeamsFormsPage.test.tsx`, `TeamsMessagesPage.test.tsx`, `AvailabilityFormSendFlow.test.tsx`, `AvailabilityBatchReview.test.tsx`, `availabilityFormProgress.test.ts`, `availabilityRecipientSelection.test.ts`, `availabilityNotificationHistory.test.ts`, and `availabilityBatchActions.test.ts`. Commands used `npm.cmd test --prefix client -- --runInBand --silent` with those file paths. Other checks: `npm.cmd run type-check --prefix client`, `npm.cmd run test:e2e:availability-workspace --prefix client`, and `git diff --check`.

Optional additional confidence: no real messages were sent and no authenticated production-server session was exercised. No server, provider protocol, schema, or credential changes are part of this patch.

## Pattern / learning opportunities
Use persisted provider evidence for delivery claims and bind projected answers to the current recipient record. Existing skills already cover these rules; no new general policy is needed.

## Final readiness
Ready for this workflow review. No required implementation or verification remains.

- Cross-boundary review performed: Yes (identity, preparation/approval, dispatch and result presentation).
- Sibling-pattern search performed: Yes (Forms, Messages, personal links, existing refresh and history readers).
- Legacy/persisted-state compatibility reviewed: Yes (legacy SMS attempts, optional recipient/submission fields, unchanged API shapes).
- Identity-switch test reviewed or added: Yes (form/church during preparation; personal link during navigation).
- Unmount/lifetime test reviewed or added: Yes (existing late history failure test; batch callbacks now reject retired manager owners).
- Contract round trip traced: Yes (recipient IDs, submission IDs, delivery outcome/status, batch approval version).
- Validate/use security boundary reviewed: Yes (existing server eligibility, consent, scope, token and approval checks remain authoritative).
- Retry-state authority reviewed: Yes (existing durable batch identity and explicit definitive-failure selection).
- Owner-retirement handoff reviewed: Yes (original API mutations can finish; retired UI callbacks are suppressed; history remains server-owned).
- External side-effect adoption/compensation reviewed: Not applicable; no new external resource creation or compensation path. Existing SMS dispatch remains unchanged.
- Authorization/data-projection reviewed: Yes (broad general-link endpoint versus restricted availability and private recipient endpoints).
- Production entry point, runtime context, and test composition compared: Yes (Forms page integration and deferred workspace/dialog paths).
