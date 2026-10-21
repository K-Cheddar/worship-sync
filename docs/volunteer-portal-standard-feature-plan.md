# Personal volunteer access as a standard feature

## Goal
Make personal volunteer access available to every church with no activation flag, preserving the existing secure implementation.

## Existing architecture
One environment gate in `getVolunteerAccessStore` makes credential, portal/recovery/admin and initial schedule-message operations conditional. The admin control additionally checks an `enabled` response field and disappears on status errors. `/s` already has an independent public bootstrap and uses the shared MySchedule renderer and operations. Manual message preparation already supports personal links with exact-review and send-time validation.

## Before behavior
Personal endpoints report unavailable and admin controls disappear without the gate. Initial message preparation can fall back to legacy schedule links. Missing security configuration is not visible until the gated code runs.

## After behavior
Every church uses personal credential operations normally. There is no replacement activation switch. Missing Firestore/dedicated secret remains a fail-closed configuration error; controls remain visible with actionable feedback. Administrators prepare and copy links in the existing member editor. Initial schedule SMS preparation uses the same personal credential through its existing deliberate review workflow.

## Product Decision Check
Authorized by the current Remove Volunteer Portal Feature Flag request, superseding the earlier default-off policy in `features/volunteer-my-schedule.md`. No new scheduling, recovery, delivery or permission policy is introduced. Secret provisioning is a security prerequisite, never an activation flag.

## Behavior intentionally unchanged
Church/member scope, 90-day configurable fixed expiry, dedicated encryption, session isolation, CSRF, revocation/generation checks, transaction-time authority, fragment ingress, privacy projections, recovery ownership and abuse limits. Existing human MySchedule and explicit legacy schedule links remain. No automatic bulk sending, deployment or real delivery.

## Acceptance criteria
- No old environment flag references or replacement feature gate.
- Personal routes and admin management work without activation configuration.
- Missing/incorrect security configuration never creates fallback authority.
- Complete synthetic admin preparation/copy -> public portal -> self-service -> reuse/recovery -> replace/revoke flows pass.
- Manual schedule message preparation retains exact approval, consent/STOP, uncertainty and dispatch safeguards.
- Current deployment prerequisites are documented, with actual Heroku readiness distinguished from local verification.

## Proposed implementation
Remove the gate and disabled response/consumer branches; remove initial-notification fallback only, preserving legacy response-token workflows. Keep the existing control/renderer; add clipboard action following adjacent member-control conventions. Update current deployment/pilot documentation and mark historical gated records superseded. Add fail-closed and no-gate regression tests using existing fixtures.

## Affected surfaces
Express personal/admin routes, server credential store construction, manual schedule-message source resolution, member editor controls, public and signed-in routing, Firestore transactions and operational documentation. No Electron IPC, projector/monitor/stream or presentation state changes. Built public HTTPS and faithful signed-in/provider composition tests cover the runtime boundaries.

## Risks / edge cases
Absent/short/reused secret; invalid lifetime; old reviewed schedule-link messages; multi-dyno key consistency; live logging capture; stale admin status/action after editor retirement; replacement response uncertainty. Do not rotate keys or renew credentials on reads. Existing send safety remains authoritative.

## Questions requiring user input
None. The product owner explicitly instructed that live Heroku access/authentication is outside this task. Document production prerequisites for separate verification; do not modify production configuration or deploy.

## Verification
Run focused server/API/message tests, real Firestore credential/recovery/response transaction suites, real built HTTPS browser ingress/admin-copy coverage, member-control/MySchedule/public/signed-in routing tests, type-check, strict lint/build and final cross-boundary review. Use synthetic data and fake delivery only. Use repository configuration patterns and official hosting documentation; do not access live Heroku again; do not recommend deployment until the live prerequisites are verified.
