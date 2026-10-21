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
Personal access remains disabled unless `AUTH_VOLUNTEER_PORTAL_ENABLED=true`. Configure a dedicated random `AUTH_VOLUNTEER_PORTAL_SECRET` of at least 32 characters, retain it across restarts, and set `AUTH_APP_BASE_URL` to the HTTPS origin. `AUTH_VOLUNTEER_ACCESS_DAYS` defaults to 90. Configure existing SMS/email delivery before assisted verification. Secret replacement invalidates personal access. Operational rollout is separate; do not enable the bulk dispatcher as part of this work.

## October 19 correctness and pilot phase

See the [correctness plan](volunteer-time-off-correctness-plan.md), current
[review](volunteer-portal-review.md) and inactive [pilot runbook](volunteer-portal-pilot.md).
The earlier review missed a draft-baseline revision transfer; the current phase
owns its correction and adversarial verification.


## Phase 2 secure credential foundation (2026-10-21)

The current request limits new work to the credential foundation. Existing broader UI/recovery/messaging came from the required merge and remains gated off. See the [Phase 2 implementation plan](volunteer-portal-phase-2-implementation.md), [current credential contract](features/volunteer-my-schedule.md#personal-credential-foundation-phase-2-contract-2026-10-21) and [Phase 2 security review](volunteer-portal-phase-2-review.md).

Implemented: v2 authenticated envelopes bound to scope/digest/generation; fixed-expiry exact reuse; fail-closed recovery of live envelopes; stable revocation across key changes with bounded legacy lookup; transactional replacement receipts; idempotent revoke/restore; authoritative session identity; crawler/prefetch denial, common rate limits/security headers; envelope redaction; trusted authorization inside each Phase 1B schedule transaction. The existing gated control now retries replacement using its retained request key. No dispatch/content changes or new management UI.

Ingress remains `/s#<token>`; Heroku documents router path logging, so path-carried secrets are excluded regardless of application redaction. The public bootstrap removes the fragment before telemetry, exchanges via HTTPS JSON and then uses only the isolated cookie. Code inspection covered Express/proxy redirects, Sentry, the service worker, public metadata and public/signed-in bootstraps. Live router/drain inventory was unavailable; this is a recorded activation verification gap, not proof of private request paths.

Confirmed policies, key/version expectations, unresolved later-phase questions and the Phase 3 identity/transaction integration contract are recorded in the feature contract. Do not change the activation flag, issue real credentials, deploy or send messages as part of this work.
