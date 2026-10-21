# Unified volunteer My Schedule

Contract status: Confirmed product intent. Milestones A–D implemented behind an explicit activation gate.
Approval source: product-owner request, 2026-10-18, “Unified My Schedule for All Volunteers.”

## Product decisions

- Account and accountless volunteers use the same My Schedule renderer and volunteer business operations. The server resolves church/member scope from a human session or validated personal credential; request member IDs never establish identity.
- Both identities can read their current and previous assignments and own responses, respond individually, accept all unanswered, submit eligible availability, manage time off, see conflicts and teammate display names, read permitted service details, and use applicable self-service preferences. Preserve signed-in filters, navigation, exports, history and account capabilities.
- Private notes, teammate contacts/responses, administrative data and Draft assignments are excluded. Missing schedule publication metadata retains legacy Published semantics. Publication and notification delivery remain separate.
- Accept all unanswered checks persisted responses in each schedule transaction. Existing answers survive concurrent bulk acceptance. Multi-schedule outcomes identify committed schedules and failures; retry skips completed answers.
- Both identities use Phase 1B's canonical pending-only acceptance over upcoming published primary assignments. Past occurrences, Drafts, existing answers and unrelated response metadata remain unchanged. Both clients follow bounded schedule pages and share partial-completion feedback. Personal credential/session generation and member authority are checked inside every independent schedule transaction, including retries. Confirmed by the October 21, 2026 Shared Volunteer Bulk Response fix request. Individual and legacy schedule-link responses retain explicit Accept/Decline semantics.
- Unsaved time-off drafts own their baseline dates and revision together. Refreshes, other successful actions and HTTP 409 cannot rebase a dirty draft. Conflicts preserve edits and require explicit review/discard before re-editing against current saved dates. Successful saves invalidate older page loads. Confirmed by the October 19, 2026 Final Correctness and Pilot Readiness request.
- After a time-off HTTP 409, saved-date comparison and Discard require a successful current-identity, current-request refresh with a nonempty revision advanced from the draft baseline. Failed, pending, unchanged, missing or older revisions preserve the editable draft and original revision, with Save and Discard blocked and an inline retry. Personal failures retain personal-link guidance. Confirmed by the October 20, 2026 conflict-refresh correction request.
- Time-off revision, ownership and archive checks and the field-limited update must commit atomically. Concurrent unrelated administrative fields and archive state must survive. A later digest failure cannot turn a durable save into a failed mutation.
- Personal bearer credentials bind one church/member, expire after a configurable 90 days, are reused while valid, and never extend on reads. Replacement invalidates earlier credentials and sessions. Deliberate administrative revocation prevents verification-based restoration until authorized administrative restore.
- Valid personal access opens My Schedule. Authentic expired access offers explicit identity verification, then automatic fresh access. Recovery requires an independently verified uniquely mapped phone or verified unique email. Consent alone proves no identity; shared contacts cannot select a member. Unknown contacts receive generic responses. No eligible channel means administrator help.
- Browser portal sessions are isolated from human/admin sessions. Legacy 120-day schedule-response and limited availability tokens never acquire personal portal authority.
- Initial schedule SMS will contain church identification, a brief schedule-ready notification, one personal link and opt-out wording. Exact reviewed body/URL must match dispatch; changed/expired credentials require fresh review. Preserve explicit approval, consent, STOP, durable delivery identity and uncertainty fences. No automatic sends, reminders or production dispatcher activation.

## Recovery safeguards

Approved by the product owner in this conversation on 2026-10-18: 10-minute
single-use codes, five guesses, 60-second resend cooldown, at most five sends per
contact/member per hour, 20 per IP per hour, and 200 per church per hour. Enforce
these budgets durably. Existing unverified contacts remain ineligible until an
administrator establishes independent possession verification. Consent is not
possession proof; do not derive the latter from an administrative consent entry.

Duplicate-contact eligibility normalizes legacy phone formats before allowing
recovery. The October 20, 2026 review-fix request authorizes a bounded lookup
after migration. Replacing the legacy scan requires a
church-scoped contact index keyed by a keyed hash of the church, channel, and
normalized contact. A safe migration must dual-write the index on every contact,
archive, and church-membership change; backfill existing members; record collisions
instead of choosing one member; and audit index coverage before reads can rely
on it. Keep the roster scan as the authority until the backfill and every
contact writer are covered, then retain a fail-closed path for incomplete or
ambiguous index entries. Contact uniqueness must remain scoped to one church.

The index is derived `volunteerContactKeys` and `volunteerContactKeyId` fields on
each roster document. Contact, archive and church changes update those fields in
the same commit; colliding members remain separate indexed documents. Church
coverage markers enable indexed reads only after backfill and audit with the
current key. Unmigrated/key-mismatched churches retain a paginated authoritative
scan without a 5,000-member rejection. See the deployment procedure in
[review fixes](../volunteer-recovery-review-fixes.md).

Lost-link recovery filters stale/ineligible verification records before requiring
one eligible church/member identity, and keeps public responses non-enumerating.
All human My Schedule reads and writes use the bootstrap's strict roster identity
resolver; ambiguous, malformed or incomplete links return an account-link error.
No active linked record retains the existing empty-read/unlinked-write behavior.

## Implementation record

See [implementation plan](../volunteer-portal-plan.md). Required milestones are
A shared core, B personal access/recovery, C shared UI, D compact messaging.
This contract records approved intent, not proof that those milestones have shipped.


## Personal credential foundation: Phase 2 contract (2026-10-21)

**Approval source:** current product-owner Phase 2 request, after the explicit request to merge local `in-progress` into `in-progress-2` (merge `0ca4eb74`). This section defines the credential foundation. The broader renderer, recovery and messaging code arrived in that merge; this phase does not expand or activate those later workflows.

### Confirmed lifecycle and authority

- A bearer is 192 random bits, scoped to one authoritative church/member pair. Contact values and names never establish identity, even when shared or identical.
- Default issuance lifetime is 90 days, configurable by `AUTH_VOLUNTEER_ACCESS_DAYS`. Expiry is fixed at issuance. My Schedule reads, redemption, refresh and reuse never extend expiry or rotate a valid credential.
- `prepare(identity)` is an intentional server operation. It issues only when no current valid credential exists, otherwise returns the identical valid token and expiry. `current(identity)` recovers an existing active credential only and never issues. Neither operation belongs in ordinary page GET/bootstrap/background reads.
- A damaged, missing, wrong-key or substituted live envelope fails token recovery with an operational error. It cannot silently authorize replacement. Digest-valid authority does not depend on recovering a delivery envelope; a damaged delivery envelope does not mint a different bearer.
- Administrative revocation persists separately from credential expiry. Expiration and contact recovery cannot clear it. Only an authorized explicit restore permits new issuance. Restore never revives an old token/session. Repeated revoke/restore of the same state is idempotent.
- Intentional replacement requires a stable 16-128 character `requestKey`. A receipt under the access record binds the resulting generation/digest and actor to that operation. Retrying the same committed request returns its existing valid credential; a superseded/expired receipt returns conflict, never another rotation or resurrection. Future notification/admin workflows must retain their operation key through an uncertain response. The existing gated control retains only this non-secret operation ID in church/member-scoped sessionStorage through retries and editor reloads; successful lifecycle adoption clears it. No bearer/envelope enters that storage.
- Only one active generation is authoritative. Replacement/revocation invalidates all older tokens and portal sessions immediately at their next authorization check. Member archival/deletion also ends access. These operations never create church memberships, Firebase accounts, ordinary human sessions, or Teams permissions.

### Storage and key management

`volunteerPersonalCredentials` is looked up by domain-separated HMAC-SHA256 token digest. `volunteerPersonalAccess` owns generation, revocation, current digest and the server-only encrypted delivery envelope. `volunteerPersonalSessions` stores digested random session identifiers and credential ownership. Browser Firestore rules deny all direct reads/writes.

New access IDs are SHA-256 over a domain-separated church/member tuple, independent of the encryption key. Legacy keyed IDs are found through an exact, bounded church/member query; ambiguous records fail closed. Existing legacy records retain their identity rather than resetting revocation. No schedule or roster migration is performed.

Envelopes use AES-256-GCM with a fresh 96-bit nonce and a 128-bit tag. Version `v2` authenticates the domain/version, church, member, credential digest and generation. The encryption derivation is separate from token/session/CSRF digest domains. Version `v1` compatibility is confined to reading its original envelope and validating the recovered token against authoritative digest/generation; intentional reuse upgrades it to v2 without changing token or expiry. Ordinary reads do not rewrite it.

Provision a dedicated high-entropy `AUTH_VOLUNTEER_PORTAL_SECRET` (at least 32 random bytes, encoded for storage), held only in the server secret store and backed up according to deployment policy. Missing keys fail closed. There is one configured key, not an automatic keyring: changing it invalidates prior token/session digests. Crucially, it does not hide member revocation. A live envelope encrypted under another key cannot be silently replaced; explicit administrator replacement or restored original key material is required. Coordinated rolling deployment and any future keyring/re-encryption procedure require a separate reviewed operation.

Encrypted envelopes are never returned from roster/bootstrap/status endpoints, placed in client state, or logged. Reusable redaction masks envelope fields and raw personal bearer/session patterns; Sentry drops personal API/administrative credential request events entirely. Schedule-specific response links retain their separate authority.

### Ingress and browser session

Selected format: **`https://<first-party-origin>/s#<token>`**, also accepted at `/s/` by the bootstrap. No live credential is placed in a path or query. Heroku documents request paths in router logs; application redaction cannot make those paths private. Fragments do not reach HTTP servers or Referer headers. Sources: [Heroku HTTP routing](https://devcenter.heroku.com/articles/http-routing), [URI fragments](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment), [Referer header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referer).

The existing public bootstrap scrubs the fragment with `history.replaceState` before enabling console forwarding/telemetry and retains it only in a module variable until exchange. It POSTs JSON over HTTPS to the dedicated redemption adapter. Raw tokens never enter localStorage, Redux, browser databases, cache entries or public redemption/session/data response bodies. Authorized explicit administrator preparation/reuse returns the personal URL intentionally. Browser extensions, clipboard and the initial pre-JavaScript address still have the original link; a fragment is a transport protection, not verified contact ownership.

Redemption issues a separate `__Host-worshipsync-volunteer` Secure, HttpOnly, SameSite=Strict cookie. Path `/` is required by the host prefix and prevents weaker subdomain/domain cookie injection; the credential is consumed only by volunteer APIs and never by human authentication. Its expiry cannot exceed the credential's effective expiry. A parallel human/admin browser identity never overrides the explicitly redeemed volunteer identity.

Volunteer endpoints have no-store/no-cache, no-referrer, nosniff and noindex headers and per-IP HTTP rate limits; redemption has its own narrower limit. Known preview crawlers and prefetch requests cannot redeem. Preview metadata is generic and cannot create credentials. Mutations require exact first-party Origin plus the dedicated session-derived CSRF header.

### Phase 3 integration boundary

The canonical transport identity carries `accessType: personal-volunteer-credential`, church/member, credential digest, generation, effective expiry, and a server-created `authorize(transaction)` callback. The validated session and authoritative member/state establish these fields. Bodies, phone/email and human bootstrap never select the volunteer.

`sessionIdentity` validates each request. Individual response and time-off writers call the authorizer inside the transaction that commits their existing business rules. `createVolunteerOperations.acceptPendingAssignments` now supports the same trusted authorizer **inside every independent schedule transaction**, and stops remaining work on authority loss. Phase 3 must pass it through, preserve per-schedule outcomes/pagination, and continue using existing My Schedule rendering/rules rather than another renderer. Permitted read projections remain explicit: own assignments/responses/time off, teammate display names and volunteer-safe service details; no contacts, teammate responses, private notes, Drafts, administrative controls or unrestricted nested loaders.

All existing portal/recovery/administration endpoints remain behind `AUTH_VOLUNTEER_PORTAL_ENABLED`, which defaults off. No activation, real volunteer issuance, delivery, new UI, OTP workflow or schedule SMS/dispatcher change is part of this phase.

### Remaining decisions and verification limits

No unresolved product choice blocks the independent backend foundation. Production secret provisioning, exact session-retention policy beyond the credential upper bound, future recovery UX and operational rollout remain subsequent work. Production router/log-drain/Better Stack inspection was attempted but no usable Heroku app inventory or logging connector was available. Code/config inspection found Sentry instrumentation and no Better Stack request logger. Fragment ingress deliberately does not rely on proving path-log suppression. Live deployment log-body settings still need review before activation; synthetic localhost browser checks do not certify production logging privacy.
