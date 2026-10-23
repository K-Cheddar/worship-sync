# Unified My Schedule implementation

## Goal
One My Schedule renderer and volunteer operation boundary for human sessions and personal access. Current work is on `in-progress-2` after the explicitly requested merge `0ca4eb74` of local `in-progress`. The sections below also retain the merged historical implementation record. See the [historical audit](volunteer-portal-audit-2026-10-18.md).

## Existing architecture
Reuse MySchedule, its blockout editor and plan panel, response transactions, personalized availability recipients, consent infrastructure and notification intents. The same route registrar powers the production server and HTTPS browser test. The public entry supplies Redux and Toast without privileged bootstrap.

## Before behavior
Signed-in volunteers used My Schedule; accountless links authorized limited responses or availability. Initial SMS listed assignments. Some self-service paths lacked Draft filtering. Time-off revision/archive checks preceded generic persistence, allowing concurrent changes to be overwritten.

## After behavior
Both identities use the same renderer and shared operations. Personal access uses fragment ingress, isolated bounded sessions, independent verified recovery and admin lifecycle controls. Pending-only bulk responses, atomic time off and eligible availability share persisted rules. Initial SMS can use a compact personal link bound to exact approval.

## Product Decision Check
The owner's Unified My Schedule request authorizes milestones A-D. Recovery TTL, attempts, cooldown and durable limits were explicitly approved. See the [confirmed contract](features/volunteer-my-schedule.md). Existing unverified contacts require assisted independent proof. No product questions remain.

## Behavior intentionally unchanged
Human authentication/CSRF/roles, signed-in filters/history/exports, 120-day response links, limited availability links, consent/STOP, explicit approval and accepted/uncertain delivery fences remain authoritative. Publication and sending remain separate. No deployment or dispatcher activation.

## Acceptance criteria and implementation
- A: shared trusted-identity operations; pending-only responses; transactional field-limited time off; Draft/archive checks at commit.
- B: configurable 90-day reusable access; replacement/revocation generations; independent recovery with atomic consumption and same-completion retry; isolated Secure HttpOnly cookie, Origin and dedicated CSRF checks.
- C: injected operations in the existing renderer/editor; safe service details; real public provider composition; pending, recovery and mobile states.
- D: compact initial SMS; deliberate credential preparation; exact approved URL validation; sanitized previews/history and real segment estimation.

## Affected surfaces
Express routes, Firestore transactions, human/personal API adapters, React public bootstrap, service worker, metadata, telemetry and existing SMS intents. No Electron IPC, presentation outputs or stream rendering changes.

## Risks / edge cases
Check reassignment/unpublication/archive during writes, simultaneous responses, same-ID identity changes, interrupted UI, other-tab sessions, changed/shared contacts, STOP, expired/replaced reviewed links, provider uncertainty and lost HTTP success.

## Questions requiring user input
None.

## Verification
Required: directly affected server/client suites; real Firestore interleavings and lifecycle; actual built mobile HTTPS entry with deferred plan/time-off/availability and fake delivery; TypeScript, strict lint/build and diff review. Results appear in the [implementation review](volunteer-portal-review.md).

## Operational configuration
Personal access is standard functionality for all churches with no activation mechanism. Configure the required stable dedicated `AUTH_VOLUNTEER_PORTAL_SECRET`, Firestore and canonical HTTPS `AUTH_APP_BASE_URL`; `AUTH_VOLUNTEER_ACCESS_DAYS` defaults to 90. Missing/invalid security configuration fails closed. See [exact deployment prerequisites](volunteer-portal-deployment.md). The independent bulk dispatcher and real delivery remain outside this code change.

## October 19 correctness and pilot phase

See the [correctness plan](volunteer-time-off-correctness-plan.md), current
[review](volunteer-portal-review.md) and [synthetic acceptance runbook](volunteer-portal-pilot.md).
The earlier review missed a draft-baseline revision transfer; the current phase
owns its correction and adversarial verification.


## Phase 2 secure credential foundation (2026-10-21)

The current request limits new work to the credential foundation. Existing broader UI/recovery/messaging came from the required merge and is now standard functionality under the later October 21 product decision. See the [Phase 2 implementation plan](volunteer-portal-phase-2-implementation.md), [current credential contract](features/volunteer-my-schedule.md#personal-credential-foundation-phase-2-contract-2026-10-21) and [Phase 2 security review](volunteer-portal-phase-2-review.md).

Implemented: v2 authenticated envelopes bound to scope/digest/generation; fixed-expiry exact reuse; fail-closed recovery of live envelopes; stable revocation across key changes with bounded legacy lookup; transactional replacement receipts; idempotent revoke/restore; authoritative session identity; crawler/prefetch denial, common rate limits/security headers; envelope redaction; trusted authorization inside each Phase 1B schedule transaction. The existing member-editor control now retries replacement using its retained request key. No dispatch/content changes or new management UI.

Ingress remains `/s#<token>`; Heroku documents router path logging, so path-carried secrets are excluded regardless of application redaction. The public bootstrap removes the fragment before telemetry, exchanges via HTTPS JSON and then uses only the isolated cookie. Code inspection covered Express/proxy redirects, Sentry, the service worker, public metadata and public/signed-in bootstraps. Live router/drain inventory was unavailable; this is a recorded production verification gap, not proof of private request paths.

Confirmed policies, key/version expectations, unresolved later-phase questions and the Phase 3 identity/transaction integration contract are recorded in the feature contract. The later standard-feature change removes activation restrictions. Do not issue real credentials, deploy or send messages as part of this code work.

## Shared bulk-response correction (2026-10-21)

Human and personal bulk routes now call `volunteerOperations.acceptPendingAssignments` through one post-commit adapter. The individual-response writer no longer offers a competing pending-only mode. Both clients use the existing paginated action and feedback, with the personal label retained. Legacy `results` fields remain on unanswered responses alongside canonical totals/cursors. Successful schedules are durable; retry starts discovery again and skips committed answers. Each personal schedule transaction calls the session authorizer, so revocation/replacement stops subsequent commits. The later standard-feature decision removes the portal gate; dispatch safeguards remain unchanged. See [implementation plan](shared-volunteer-bulk-response-plan.md) and [review](shared-volunteer-bulk-response-review.md).


## Standard feature (2026-10-21)

The product owner approved personal access for every church without a replacement activation mechanism. Runtime disabled branches and disabled-status UI assumptions are removed. The administrator member editor exposes preparation/copy and visible configuration failures. Manual initial schedule SMS uses personal credentials through existing preparation/review; scoped previews redact personal links. Human and personal scheduling remain shared. See [implementation plan](volunteer-portal-standard-feature-plan.md), [deployment requirements](volunteer-portal-deployment.md) and [final review](volunteer-portal-standard-feature-review.md).

## Phase 3 shared-experience completion (2026-10-21)

The attached Complete and Enable Accountless My Schedule request requires the actual administrator-to-volunteer experience. Existing shared scheduling/read/write/rendering code was reused. Corrections retain a usable fragment credential through transient failures, retire completed redemption work, add in-page load/refresh retry without losing dirty Time Off, apply the returned church name to personal service details, add explicit admin lifecycle completion feedback and exclude sensitive admin controls from replay.

The expanded built HTTPS harness uses the actual operator member editor plus public mobile/desktop entry, real human and volunteer HTTP authorization, shared transactions and Firestore emulator persistence. It exercises clipboard transfer, stable reuse, nested plans/PDF, filters, partial bulk completion/retry, interrupted saves, no-assignment self-service, assignment removal, session return and authority loss. See the [completion plan](volunteer-portal-phase-3-completion-plan.md) and [review with exact results](volunteer-portal-phase-3-completion-review.md). Production configuration, deployment and real delivery remain separate; no live Heroku access is needed or performed for this phase.
