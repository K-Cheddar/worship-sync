# Phase 2 secure credential implementation ? 2026-10-21

## Goal
Harden the merged personal access implementation for reusable church/member credentials without enabling the portal, delivering messages, or extending the existing renderer/recovery.
## Existing architecture
Merge 0ca4eb74 already contains volunteerPersonalAccess, isolated cookies, fragment scrubbing before telemetry, shared mutation adapters, recovery and future SMS preparation behind the existing activation gate. Reuse those modules.
## Before behavior
Unrecoverable live envelopes silently replace credentials; envelopes bind only a keyed member scope; keyed scope IDs can lose persistent revocation across key changes; replacement retries rotate again. Phase 1B bulk operations have a separate per-schedule mutation boundary.
## After behavior
Explicit valid reuse fails closed on corrupt/unavailable envelopes, binds v2 encryption to church/member/digest/generation, retains revocation independently of encryption-key changes, and supports durable replacement request receipts. Personal authorization remains separate from human identity and is revalidated for every independent bulk transaction.
## Product Decision Check
Current Phase 2 request authorizes fixed configurable 90-day lifetime, intentional reuse, revocation, explicit restore, replacement invalidation, fragment ingress if path logging cannot be excluded, and backend authorization primitives. Existing broader UI/recovery/messaging from the requested merge is preserved but not expanded or activated. No new product decisions required for independent backend work. Production logging access may remain unavailable; fragment transport does not depend on path privacy.
## Behavior intentionally unchanged
No Firebase accounts, human sessions, contact matching, legacy schedules, renderer, dispatch or recovery workflow changes.
## Acceptance criteria
Lifecycle, integrity/key-failure, idempotent uncertain retries, cross-member/church isolation, real concurrent processes/Firestore races, session invalidation and synthetic HTTP/browser ingress verification. Actual production logging inventory or explicitly documented access limitation.
## Proposed implementation
Extend the focused credential store; use stable access scope IDs with read-only lookup of legacy records, v2 AES-GCM AAD, transactional lifecycle receipts and bounded field validation. Extend the canonical pending-only operation with a trusted transaction authorizer; preserve its business rules. Keep existing disabled route gate.
## Affected surfaces
Credential documents/access state/sessions, portal transport adapter, shared volunteer mutation boundary, logging redaction, feature contract and tests. Client shell already handles fragment transport; no new UI.
## Risks / edge cases
Malformed persisted authority, unavailable keys, envelope substitution, key change after revocation, stale replacement retries, generation changes between independent bulk commits, archive/delete during commits, previews, human cookies and crawler redemption.
## Questions requiring user input
None for backend implementation. Production activation and future session/recovery UX remain outside this request.
## Verification
Node 24 focused server/auth suites, real demo Firestore lifecycle and cross-process races, built HTTPS browser and HTTP cases, production-relevant public and signed-in bootstrap. Report unperformed production account inspection without claiming private router paths.
