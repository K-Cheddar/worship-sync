# Phase 3 shared My Schedule: completion review

Scope: workflow review of the combined uncommitted changes from `79c165e` on `in-progress-2`, including standard availability and the attached Complete and Enable Accountless My Schedule request. This is an implementation/workflow completion claim, not certification of production configuration or a deployment.

## Findings

Critical: None remaining. High: None remaining. Medium: None remaining. Low: None remaining.

### What already existed

The merge had introduced `VolunteerPortal`, public `/s` bootstrap, isolated cookie/CSRF transport, injected `MyScheduleOperations`, the existing MySchedule renderer, safe per-member schedule/plan projections, individual/bulk responses, conflict-aware Time Off, availability, search/team/service filters, history, exports, preferences link, credential lifecycle and verified recovery. Prior standard-feature work removed the flag and initial-SMS legacy fallback. Reuse of this architecture was sufficient; no second renderer, auth system or response logic was added.

### Defects and integration gaps corrected

- `api/volunteer.ts`: HTTP 429/5xx discarded a valid ingress secret, while a completed redemption promise could suppress a later link. Transient failures now retain ingress only in memory for explicit retry; definitive denials clear it, expiration retains it for verified recovery, and settled redemption work is retired.
- `VolunteerPortal.tsx`: transient server errors appeared as invalid access. They now have clear retry/pending feedback, without account sign-in or unintended recovery.
- `MySchedule.tsx`: initial failure had no in-page retry; background authority loss lacked page-level guidance. Retry preserves mounted dirty Time Off and existing revision ownership. A member disappearing during initial read gets personal guidance, not an instruction to link a nonexistent account. The returned church name now reaches personal service details.
- Existing member controls: added explicit prepare/replace/revoke/restore completion feedback alongside existing pending/failure handling and copy action. Durable replacement retry keys remain unchanged.
- Privacy: the operator app enables Sentry replay; installed SDK defaults mask text but omit `href` from default masked attributes. Personal-link/recovery controls now use the SDK's supported `data-sentry-block` exclusion. Public portal telemetry remains disabled and fragments are scrubbed before bootstrap.
- Verification: the harness now opens the actual built operator member editor and public entry. Its web build explicitly uses `VITE_API_BASE_PATH=/`, overriding only the test process's developer-local API URL. No configuration file was modified. It tests real clipboard transfer and both identities instead of using a component mock as end-to-end proof.

## Product authorization status

Authorized by the attached request and `features/volunteer-my-schedule.md`: shared functionality, standard access for every church, retryable errors, draft preservation, personal identity/privacy, real admin/browser journeys and separate deployment requirements. Feature activation restrictions are superseded; the removed variable has no remaining working-tree reference. The independent message dispatcher, consent/STOP, approval and delivery-uncertainty boundaries remain unchanged. No live Heroku access, production configuration change, real delivery or deployment is part of this phase.

## Open questions / assumptions

None blocking Phase 3. Existing verified recovery is reused; no new recovery or session-duration policy is introduced. The roster member must exist and be active, but needs no Firebase user, human membership or Teams permission. Per-member administrative revocation remains authorization state, not a feature activation mechanism.

## Verification gaps

Required implementation/workflow checks: None remaining.

Separate deployment prerequisites: stable dedicated personal secret, canonical HTTPS Origin/first-party API routing, existing Firestore/server configuration, deployed IAM/rules/indexes, provider readiness and production privacy/logging checks. These are documented in [deployment prerequisites](volunteer-portal-deployment.md); no deployment recommendation is made before separate verification. Full repository CI, physical phones, an actual Electron process, live identity-provider login and real provider delivery were not run. No Electron/IPC/display code changed; signed-in routing and shared renderer compatibility tests passed.

### Actual runtime composition

Production-context result: **Pass** for the affected repository workflow. The harness serves built production assets over HTTPS, using the production `registerVolunteerRoutes`, actual `authHandlers.getAuthMe`, `getTeamsBootstrap`, `getServicePlan`, cookie/CSRF guards and real Firestore transactions. It launches the normal operator `/#/teams-and-services/members` entry with its actual providers, opens the member editor, prepares/copies/reuses/replaces/revokes through real HTTP, and follows the copied link in both a fresh accountless mobile context and an existing admin desktop context. The seeded human bearer is a supported real auth transport; bootstrap/CSRF and administrative authorization are not mocked. Unrelated integrations return 503 and external requests are blocked; the test does not claim to certify Azure/Couch/Firebase identity-provider connectivity. It does not launch all of `server.js` or its background integrations.

`server.js` was traced through real route registration, personal no-store/no-referrer middleware, static asset handling and human SPA fallback. The browser harness uses the same route registrar/handlers and human-browser bootstrap/renderer for the relevant calls. Personal supporting requests remain `/api/volunteer/*`; plan details use the restricted assignment payload, not privileged service-plan/public-share APIs. Fresh personal-only cookies are explicitly rejected by actual Teams bootstrap and privileged service-plan handlers. Fragment removal, no human bootstrap in the personal page, no token in storage/cache/referrers/logs, safe response projections and cookie attributes are checked. Actual mobile Time Off and desktop service-plan screenshots were inspected; horizontal overflow and privacy fixture assertions passed.

### Adversarial workflow evidence

Pass A derived invariants from the request: explicit credential identity, fixed credential authority, preservation of unrelated data/drafts, retry after durable work, supporting-call privacy and availability without assignments. Pass B traced the actual caller/transport/transaction/renderer boundaries and controlled the following transitions.

| Invariant | Controlled transition | Code/test evidence | Result |
| --- | --- | --- | --- |
| Transient ingress does not destroy a usable link | 429/503 or lost response -> no secret in address/storage -> retry same in-memory ingress; successful redemption followed by failed session lookup retries cookie only | `volunteer.test.ts`; actual public browser first redemption and initial schedule temporarily return 503 until explicit retry | Pass |
| An existing human account never selects personal identity | Admin prepares/copies link in real editor -> opens it in same desktop context with human bearer -> session and safe schedule still belong to volunteer; fresh mobile context has no human credentials | Built browser; actual `sessionIdentity` and safe data response assertions | Pass |
| Partial bulk completion survives retry | A real schedule transaction commits, another throws before update -> HTTP reports one accepted/one failed -> UI retries -> only remaining schedule commits, first response including timestamp unchanged; dirty date revision stays owned by editor | Built browser transaction proxy controls failure, delegates all actual auth/reads/writes to Firestore; canonical transaction tests cover decline/reassignment/revocation races | Pass |
| A lost save acknowledgment cannot lose a draft or duplicate work | Date selected via calendar -> Time Off commits -> response connection reset -> draft retained -> retry gets 409 -> current saved dates reviewed/discarded deliberately -> edit/save/remove | Empty-assignment browser journey using real HTTP/Firestore and `MyScheduleBlockouts` | Pass |
| Removing a slot removes data scope, not self-service | Published assignments removed while credential remains valid -> reload omits those services, keeps Time Off -> authoritative fixtures restore assignments | Built browser; canonical reassignment/ownership transaction tests | Pass |
| No assignment/account is needed for self-service | Accountless active member has no schedule -> empty state -> add/edit/remove date and submit personalized availability -> new tab `/s` restores session | Built browser with independent synthetic member and cookie context | Pass |
| Authority loss cannot erase an unsaved date edit | New generation invalidates old link/session; replacement redeemed -> dirty date entered -> real admin revokes -> save rejected, draft still present and persisted dates unchanged; archived/deleted member session denied | Built browser and transaction-time credential tests | Pass |
| Nested views/exports do not widen scope | Search/team/service filters -> current/past rows -> individual decline/accept -> static permitted plan with church name -> PDF preview/download; Draft/private/other-response markers absent | Built mobile/desktop browser; raw safe response assertions; actual privileged API denials | Pass |
| Existing compatibility and message safety survive | Signed-in shared operations, legacy schedule-response/intake links, manual SMS review with credential URL, STOP/consent/accepted/uncertain delivery fences | Focused API/client suites and Firestore races below; no provider sends | Pass |

### Exact successful verification

Node `v24.12.0`. All server/emulator commands use `DOTENV_CONFIG_PATH=NUL` and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`; Java 21 / Firestore emulator `1.22.0`. All identities and delivery are synthetic/fake. Browser suites run separately from server suites because legacy emulator fixtures share collection cleanup. Existing metadata-discovery `EACCES`, Vite fixture-URL and large-chunk advisories do not fail these checks.

- `node --import tsx --test --test-concurrency=1 server/teamsApi.test.js server/notificationIntents.test.js server/volunteerOperations.firestore.test.js server/scheduleResponses.test.js server/volunteerOperations.test.js server/volunteerProjection.test.js server/volunteerPrivacy.test.js server/volunteerPersonalAccess.firestore.test.js server/volunteerRecovery.firestore.test.js server/volunteerCredentialHttp.firestore.test.js server/volunteerMutations.firestore.test.js server/volunteerOperationsMutationBoundary.firestore.test.js server/volunteerIdentity.firestore.test.js`: **438 passed, 0 failed, 0 skipped**.
- `npm test --prefix client -- --runInBand --watch=false src/api/volunteer.test.ts src/public/PublicApp.portal.test.tsx src/pages/__tests__/MySchedule.test.tsx src/pages/__tests__/MySchedule.timeOffConcurrency.test.tsx src/pages/Teams/managers/VolunteerPersonalAccessControls.test.tsx src/pages/Teams/managers/MemberManager.test.tsx src/App.test.tsx src/public/PublicApp.test.tsx`: **8 suites, 188 tests passed**. Includes all directly modified/new tests.
- `npm run type-check --prefix client`: **passed**.
- `VITE_API_BASE_PATH=/ npm run build:strict --prefix client` (process environment set in PowerShell): **passed**, including ESLint `--max-warnings 0`, Vite production assets and PWA service worker. No environment file changes.
- `node --import tsx --test server/volunteerBrowser.firestore.test.js` against that bundle: **1 extended end-to-end journey passed, 0 skipped**. It includes the actual operator editor/clipboard/lifecycle, desktop personal tab, fresh mobile portal, retry/partial/durable failure cases, no-assignment self-service, session return, expiration/recovery and authority/privacy checks described above. Optional screenshot variables captured mobile/desktop views for visual inspection.
- Full working-tree search including ignored local configuration (excluding dependencies, generated assets, logs and git metadata): **zero removed-flag references**. `git diff --check`: **passed**.

## Pattern / learning opportunities

Default replay text masking is insufficient for a bearer link's attributes; explicitly block the small credential-control region. Test the real provider/entry composition and production-relevant API base, not a developer-local build or an injected privileged component wrapper. The larger test diff is intentional: it completes the requested workflows using one existing harness; runtime changes remain local and reuse the established renderer/operations. No new framework or permanent repository policy was introduced. The existing unreleased My Schedule note covers this feature.

## Final readiness

**Ready** for the stated Phase 3 implementation/workflow scope. No remaining Phase 3 integration work is known before the feature can be deployed with its required configuration. Production configuration verification and deployment are separate and were not performed.

- Cross-boundary review performed: Yes.
- Sibling-pattern search performed: Yes; ingress/session errors, shared loaders, date/availability saves, admin status/lifecycle, nested plan/export calls and notification serialization traced.
- Legacy/persisted-state compatibility reviewed: Yes; shared source/publication rules, fixed expiry, receipts and legacy response/intake authority remain intact; no migration.
- Identity-switch test reviewed or added: Yes; repeated-ID church retirement tests executed; actual admin/personal coexistence and replacement verified.
- Unmount/lifetime test reviewed or added: Yes; existing renderer retirement and admin reload tests executed; late UI publication remains suppressed.
- Contract round trip traced: Yes; trusted identity -> safe API payload -> shared renderer/filter/export -> scoped mutation -> authoritative result.
- Validate/use security boundary reviewed: Yes; every write retains transaction-time authority; supporting reads never acquire privileged tokens.
- Retry-state authority reviewed: Yes; persisted responses/credential receipts own durable progress, date drafts retain their original revision, in-memory ingress owns only incomplete redemption.
- Owner-retirement handoff reviewed: Yes; original request may finish, retired views stop state/toast publication; no global Activity work was added.
- External side-effect adoption/compensation reviewed: Yes; link preparation/copy sends nothing; existing manual approval and provider uncertainty fences remain. No compensating deletion or automatic send/retry was added.
- Authorization/data-projection reviewed: Yes; actual personal-only privileged API denials, safe nested data, Draft/private exclusions and telemetry handling verified.
- Production entry point, runtime context, and test composition compared: Yes, with precise scope/limitations above.
