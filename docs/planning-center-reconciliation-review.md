# Planning Center reconciliation review

Scope: workflow review of this task's complete diff against base
`5349bbaf35beee08d63a5bc8899669906fb50d02`, not a production-readiness review of
unrelated branch changes. Method: separate adversarial self-review using
`.agents/skills/code-review/SKILL.md` and its stateful/cross-boundary references.

## Findings

Critical: None remaining.

High: None remaining. Review exposed stale preview/during-read draft replacement;
the editor now preserves the newer draft and requests a fresh import. Controlled
deferred-read and after-preview edit tests pass.

Medium: None remaining. Review exposed old PDF review flags suppressing reliable
account-ID reorder operations, and raw candidate positions disagreeing with
executed positions around manual items. Both have focused regression coverage.
Template creation now clears occurrence-specific PDF evidence and review flags.

Low: None requiring a follow-up.

## Product authorization status

Authorized: canonical song-category meaning, source-owned matching, minimal moves,
selected-only operations, transient positions, durable ownership/decisions,
legacy fallback, draft preservation and compact review are covered by the current
request and the updated import feature contract. No consequential product choice
was inferred solely from old tests. The old two-moves-for-one-swap and selectable
timing-shift expectations were changed deliberately to meet the requested model.

## Open questions / assumptions

No blocking questions. Original binary PDFs and API snapshots were not attached;
the request permits equivalent fixtures. Update 2 contents are representative
and documented rather than asserted to be the unavailable original.

## Verification gaps

Required: None remaining after the recorded checks pass.

Optional: live Firestore/Planning Center/church smoke run, full repository CI,
separate human reviewer. These checks are not claimed to have run.

Production-context verification: Pass. Traced Services' PDF file input and lazy
pdfjs extraction, production parser/builder, import review and selected executor,
one draft/undo mutation, existing revision-guarded save, server authentication and
normalization, datastore and API read. Browser and Electron compile these same
modules. Mounted editor tests provide the existing GlobalInfo, RehearsalPlayback
and Toast contexts; network and PDF extraction are mocked there. Complementary
server tests use actual PDF bytes and real parser/reconciliation/auth handlers,
with the isolated server database adapter. External account access is exercised
through the real mapper with representative responses, not live credentials.

| Invariant | Adversarial sequence | Code path | Test evidence | Result |
| --- | --- | --- | --- | --- |
| IDs/local work survive normalization | Baseline save -> mic edits -> save/read -> Update 1 -> save/read -> repeat | PDF parser, prepare/refresh, summary/apply, save/get handlers | `Planning Center PDF baseline save reload Update 1 preserves identity and proposes four operations` | Pass |
| Decline stays authoritative | Update 2 ordinary approvals -> decline duplicate -> save/read -> reimport -> confirm -> repeat | PDF claim reservations, review-required flag, server normalization | Same lifecycle plus singleton and duplicate regression cases | Pass |
| No unrelated order changes | Reordered source plus addition -> approve only addition; all 24 permutations | LCS operation detection and selected placement | `executes every source permutation...` and server partial-approval cases | Pass |
| Preview equals approved execution | Source rows separated by manual cue -> approve two moves | Review `selectedSections`, shared executor | `shows reorder positions from the executed selection...` | Pass |
| Newer draft wins | Hold PDF read -> edit duration -> resolve; separately open review -> edit -> Apply | PDF version guard and preview snapshot guard | `preserves edits made while reading/reviewing a PDF import` | Pass |
| Owner switch suppresses old result | Hold PDF read -> switch plan -> resolve | `currentEditorIdentityRef`, existing preview reset | `ignores a PDF import that finishes after switching to another plan` | Pass |
| Durable API identity outranks stale PDF flags | Flagged account occurrence -> real reorder -> review -> apply | association table and summary eligibility | `reviews a reliable account occurrence reorder...`, existing durable-ID cases | Pass |
| Legacy/source formats remain usable | Save/read all source enums and provenance -> real account mapper -> refresh -> save; import old keyless records | shared metadata validators, account mapper, template/native boundaries | metadata contract, legacy singleton, native/template and URL suites | Pass |

Review also traced existing revision checking, save-operation acknowledgment and
retry recovery; this task adds no writer, datastore switch, external job or
publication path. Existing autosave/merge/editor tests run with the affected suites.
Resource/note/assignee merge rules remain in their existing ownership functions.
The server still validates only allowed fields and public projections remain
explicit; newly durable import metadata is not added to public plan snapshots.

## Pattern / learning opportunities

Shared validated types and regression tests enforce the contract. No permanent
agent-policy additions or new framework are needed.

## Final readiness

Ready for the reviewed workflow scope, subject to the verification results in
`planning-center-reconciliation.md`; this is not approval to deploy the branch.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; account/URL import, templates, native
  transfer, server song/source normalization, ownership and timing consumers.
- Legacy/persisted-state compatibility reviewed: Yes.
- Identity-switch test reviewed or added: Yes.
- Unmount/lifetime test reviewed or added: Yes; existing editor identity/reset and
  teardown coverage inspected; no new long-lived callbacks or owner introduced.
- Contract round trip traced: Yes.
- Validate/use security boundary reviewed: Yes; existing server auth and allowed
  field normalization retained; no new URL fetch or external resource use.
- Retry-state authority reviewed: Yes; no selected import writes until draft
  mutation; existing revision-safe autosave retains persistence ownership.
- Owner-retirement handoff reviewed: Not applicable; no new job/provider handoff.
- External side-effect adoption/compensation reviewed: Not applicable; imports
  create no remote resource and no compensating deletion.
- Authorization/data-projection reviewed: Yes.
- Production entry point, runtime context and test composition compared: Yes.
