# Data integrity review — 2026-10-29

## Findings
No remaining Critical, High, Medium, or Low findings in the reviewed change. Review scope: workflow review and fix verification of the four requested mechanisms, against `in-progress` HEAD `cae1cf80`. This is not a production-readiness review of every change already on the branch.

## Product authorization status
Authorized by the current request. `features/controller-startup-and-saves.md` records the controller guarantees; `features/service-plan-import.md` records native import lifetime and optional phase preservation. Offline cache, guest/demo seed, explicit replacement confirmation, destination identity/publication, ID regeneration, foreign ownership stripping, and format version 1 remain intact.

## Open questions / assumptions
None blocking. PublicServiceFlowSection does not contain a phase, and the public projection supplies none; public-link copies retain the existing absent/main semantics. Native JSON round trips preserve every supplied valid phase. No public API expansion was introduced.

## Verification gaps
Required gaps: none. **Entire change set inspected**, including new files, consumers/writers, and affected contracts/tests; local Git comparison was not capped or paginated. Tests below were both inspected and executed. Specialist review guidance explicitly loaded: persisted-mutation-safety, reliable-state-mutations, react-quality, react-state-performance, and the stale-async/identity-keyed-draft patterns.

Production-context verification: **Pass**. The new integration test mounts the actual ControllerInfoProvider, Outlines, controller lifecycle, and Redux together. It explicitly overrides Jest's normal controllerInfo mapper so consumers cannot silently use a different context. PouchDB I/O and remote completion are controlled. The editor tests use the existing production-faithful GlobalInfo/Toast/Rehearsal wrapper and exercise the import menu, file input, replacement dialog, and draft/occurrence changes. Redux persistence tests execute the actual listeners with controlled concrete databases and revisions.

| Invariant | Production entry / authoritative owner | Consumer and writer | Boundary / adversarial sequence | Exact executed test evidence | Result |
| --- | --- | --- | --- | --- | --- |
| Initial local absence cannot authorize defaults | ControllerInfoProvider; concrete DB + databaseSessionKey + content replication token | Outlines, useControllerPageLifecycle; controllerBootstrapDocs and scoped media route loader | Empty local cache -> consumers load -> remote documents arrive -> successful completion -> refresh | `controllerBootstrap.integration.test.tsx`: “shows delayed remote outlines, details, preferences and scoped routes without navigation or default writes”; “creates defaults once after a successful empty remote pull”. Actual puts and visible values asserted. | Pass |
| Offline data and edits survive verification | Same provider/session; saved Pouch documents and pending operator edits | Outline/detail/preference/folder consumers; Redux hydration | Saved local content -> stalled pull -> operator edits -> pull completes | Integration: “keeps saved local content available while the first remote pull stalls”; “refreshes saved values after the pull while preserving operator edits made offline”. Aux tests check replicated registry authority and verified-empty scope creation. | Pass |
| Progress, cancellation and stale sessions cannot grant readiness | Provider replication handle and session token | bootstrapReady/canCreateBootstrapDocuments -> automatic writers | Progress 100 -> incomplete/cancelled/failed pull; start A -> activate B -> complete A | `controllerInfo.test.tsx`: initial-content-completion test; cancelled/failed initial pull cases; “ignores a previous church's delayed initial pull”. Helper ownership test rejects a missing-document read after ownership expires. | Pass |
| Latest local same-field intent survives | store listeners -> concrete DB + outline + field | Pending/saved Redux and broadcasts; persistServiceListField | A pauses in get/put -> B supersedes -> A resumes or receives 409 -> B commits after entered A put | `persistServiceListField.test.ts`: “keeps the latest same-field intent when the older %s is delayed” (read/put/conflict). `store.test.ts`: “serializes superseded %s saves and acknowledges only the latest persisted draft” (items/overlays). Final documents, pending flags, and publication asserted. | Pass |
| Independent fields and outgoing owners survive | Actual item-list/overlay-order listeners; original concrete DB | Outline/overlay reducers and broadcast consumers; field queue/revision retries | Items and overlays conflict; outgoing A put pauses -> edit B; switch databases with same document ID -> old completion | Store tests: “keeps outline and overlay-order edits when their saves overlap”; “finishes an outgoing outline save even when another outline starts saving”; “keeps same-ID database saves, acknowledgments and broadcasts with their original owner”. Existing conflict/failure/remote-hydrate tests retained. | Pass |
| Native proposals belong to the captured draft | Services -> ServicePlanEditor; existing user/church/plan identity and draftChangeVersionRef | JSON/public handlers -> pending proposal -> ConfirmDialog -> updateDraft/undo/autosave | Load or confirmation for A -> switch to B or edit -> resolve/confirm; old failure while B import remains pending | `ServicePlanEditor.test.tsx`: “protects native %s imports across a %s” (both sources × four boundaries); “keeps the current plan's import pending after a stale %s completion”; “protects direct native %s imports into an empty draft (edited: %s)”; successful native replacement cases. | Pass |
| Phase survives normalization and main-only filtering | ServicePlanSection -> export/import/cleanSections | JSON consumers; servicePlanToImportData -> mapNativeServicePlanParticipants | pre/main/post + legacy absent -> serialize -> same/foreign import -> real participant mapping | `servicePlanNativeTransfer.test.ts`: “preserves phases and order when transferred to %s” (both churches), invalid-phase rejection, retained identity/ownership/order tests. Real mapping selects only main and legacy rows. | Pass |

### Checks actually executed
Final focused Jest run: **12 suites, 331 tests passed** (`node node_modules/jest/bin/jest.js --runInBand --silent --runTestsByPath ...`, from `client/`). Files:
- `src/context/controllerBootstrap.integration.test.tsx`
- `src/context/controllerInfo.test.tsx`
- `src/utils/controllerBootstrapDocs.test.ts`
- `src/utils/controllerMediaRouteFolders.test.ts`
- `src/utils/persistServiceListField.test.ts`
- `src/utils/contentReplicationActivity.test.ts`
- `src/pages/Controller/useControllerPageLifecycle.test.tsx`
- `src/containers/Toolbar/ToolbarElements/Outlines.test.tsx`
- `src/store/store.test.ts`
- `src/pages/Services/servicePlanNativeTransfer.test.ts`
- `src/integrations/servicePlanning/mapNativeServicePlanParticipants.test.ts`
- `src/pages/Services/ServicePlanEditor.test.tsx`

The complete editor file includes the existing Planning Center PDF import, review, edit-protection, and identity-switch cases. They passed. Client `npm.cmd run lint:check --prefix client`, `npm.cmd run type-check --prefix client`, `npm.cmd run build --prefix client`, and `git diff --check` passed. The Vite build needed approved unsandboxed ancestor-directory access for esbuild; it completed with existing large-chunk/fixture-URL warnings.

Fail-before evidence: the initial persistence/phase run failed six regressions against the defective helpers. A separate controlled run using original HEAD bootstrap/editor source failed seven new regressions (unverified-404 bootstrap and native edit/confirmation lifetime). Edited source was restored afterward. Passing runs verify the corrections.

Optional confidence checks not performed: real CouchDB/browser/Electron interactive smoke, Electron packaging, and exhaustive repository/server suites. Controlled production-composition tests establish the requested boundaries; this review does not claim a live multi-device deployment was exercised.

## Second adversarial pass
Performed separately from the implementation-driven test pass: re-derived the event sequences from the request and traced production ownership before comparing tests. The initial-replication sequence also led to checking aux initialization against the post-pull database, rather than still-hydrating Redux; the final test proves both existing-remote and verified-empty aux paths. The persistence sequence traced an entered put, a conflict retry, independent fields, outgoing ownership, exact acknowledgment, publication, and cleanup eligibility. The import sequence traced confirmation retirement and loading/error ownership in addition to successful content application. The schema sequence traced the actual main-only participant mapper, not a test-only phase filter.

Targeted sibling search covered all production loadOrCreate callers, automatic aux creation, scoped media folders, split-preference migration callers (none automatic), both service-list helper callers, all three editor importer loading/finally paths, server phase normalization, public section shape, and the real main-only consumer. PDF parsing/reconciliation and display rendering were not changed. Additional production complexity is limited to the scoped queue, import proposal ownership, shared readiness projection, and a preference hydration baseline needed to preserve edits; most added code is regression evidence.

## Pattern / learning opportunities
The revised code-review skill requires an evidence table naming entry/authority, consumer/writer, boundary, concrete event sequence, exact inspected/executed test or missing test, and result. Its validation reference now includes the four original failure mechanisms. It explicitly requires specialized skill loading and distinguishes entire/scoped/truncated coverage and inspected/executed tests, including pagination/capped-result handling. This procedure would prompt inspection of all four original defects; it cannot guarantee detection of every future bug.

## Final readiness
**Ready** for the stated workflow/fix-review scope.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes.
- Legacy/persisted-state compatibility reviewed: Yes.
- Identity-switch test reviewed or added: Yes.
- Unmount/lifetime test reviewed or added: Yes (provider retirement and editor import/confirmation ownership; shared existing isMountedRef also guards completion).
- Contract round trip traced: Yes.
- Validate/use security boundary reviewed: Yes (untrusted JSON phase validation and proposal identity/version at use; permissions unchanged).
- Retry-state authority reviewed: Yes.
- Owner-retirement handoff reviewed: Yes (outgoing persistence continues against its original DB; stale UI/publication suppressed).
- External side-effect adoption/compensation reviewed: Not applicable; no new external resources or compensation workflow.
- Authorization/data-projection reviewed: Yes (destination ownership stripping and unchanged public projection).
- Production entry point, runtime context, and test composition compared: Yes.
