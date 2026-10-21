# Phase 3 shared My Schedule completion

## Goal
Verify and finish the real admin-link to accountless My Schedule journey, preserving the shared renderer, operations, privacy and signed-in behavior.

## Existing architecture
Current HEAD is `79c165e`; the preceding standard-feature changes remain uncommitted and are part of this combined implementation. Existing code already supplies public fragment ingress, isolated sessions/CSRF, the MySchedule renderer with injected operations, own-member projections, restricted static service plans, shared individual/bulk response transactions, availability, conflict-aware time off, search/team/service filters, schedule export and admin lifecycle controls. No replacement renderer or auth system is needed.

## Before behavior
Core self-service works through real HTTP/Firestore in the existing mobile browser test. Gaps found in this audit: transient redemption HTTP errors discard the ingress credential and look like invalid access; initial schedule failure has only a browser-refresh instruction; background access loss has no page-level feedback outside the date editor; personal church branding is returned but unused. Existing admin tests reach prepare/copy in a component plus real HTTP, while the browser harness needs the full existing editor journey and broader empty/filter/error/desktop coverage.

## After behavior
Valid ingress survives transient failures in memory only, with a retry action. Definitive credential failures remain fail-closed. Schedule loading and refresh failures have explicit retry/access guidance without replacing a mounted dirty date draft. Admin lifecycle actions provide pending/success/failure feedback. Real browser journeys cover the existing UI, actual HTTP guards and Firestore persistence on mobile and desktop, including empty schedules and nested views.

## Product Decision Check
Authorized by the attached Complete and Enable Accountless My Schedule request and current `features/volunteer-my-schedule.md`. Standard availability, shared capabilities, explicit retry states, draft preservation and real admin/browser verification are requested. No new permission, recovery policy, account requirement, automated sending or production configuration change is introduced.

## Behavior intentionally unchanged
Human navigation/auth, explicit legacy response and availability links, fixed 90-day configurable credentials, revocation/generation/transaction checks, restricted service plans, recovery ownership and abuse budgets, manual approval/consent/STOP/uncertainty fences and independent dispatch controls. Browser/Electron presentation surfaces are outside this change.

## Acceptance criteria
- Admin prepares, copies, reuses without extending expiry, replaces and revokes using existing controls through guarded HTTP.
- Fresh accountless mobile/desktop browsers load shared MySchedule; current/past/filter/detail/export/individual/bulk/time-off/conflict/availability paths work as permitted.
- Empty or removed assignments do not hide permitted time off and availability.
- Transient ingress/data failures retry without losing a usable secret or date draft; authorization errors remain personal, never human-login redirects.
- Refresh/reopen restores valid authority; invalid/expired/replaced/revoked/archived/deleted identities fail safely.
- Draft/private/cross-member/nested data remains inaccessible, including with human credentials present.
- No feature flag, deployment or real delivery.

## Proposed implementation
Correct transient ingress classification and promise retirement in the existing API adapter; reuse existing MySchedule load/state ownership for retry feedback and church name; add concise admin success feedback. Extend the existing HTTPS/Firestore harness, real public entry, and existing tests. Trace actual production registration and static SPA composition. Prefer the actual operator editor entry for admin browser coverage; any test-only unrelated transport substitute must be identified rather than counted as authorization proof.

## Affected surfaces
Volunteer API client/portal state, shared MySchedule loading feedback, admin controls, public/operator bootstrap and browser fixture HTTP registrations, and contracts/review docs. Persistence and scheduling business rules remain authoritative in existing operations. No new Firestore schema or account creation.

## Risks / edge cases
Lost redemption success, HTTP 429/5xx versus definitive credential denial, StrictMode duplicate redemption, credential/session identity changes, stale refresh after mutation, dirty draft versus background authorization failure, empty roster schedule projection, nested service-plan/export calls and operator bootstrap dependencies. Retired views suppress state publication; successful durable writes remain safe to retry.

## Questions requiring user input
None. Live Heroku access, real messages, production environment changes and deployment are explicitly excluded; deployment prerequisites are documented separately.

## Verification
Run focused adapter/public/renderer/admin/signed-in tests; real credential/recovery/response/time-off transaction suites; updated built HTTPS browser journeys with real admin/personal HTTP and Firestore, mobile/desktop and deferred views; type-check, strict lint/build and final cross-boundary review. Record exact coverage and distinguish real entry-point evidence from mocks. Full repository CI and deployed/provider/physical-device checks remain separate.
