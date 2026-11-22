# Unified volunteer My Schedule

Contract status: Confirmed product intent. Personal access is standard functionality for all churches, with no feature flag or church activation mechanism.
Approval source: product-owner request, 2026-10-18, “Unified My Schedule for All Volunteers.”

The October 21, 2026 “Simplify My Schedule Cards and Share the Service Card Design” request supersedes the My Schedule availability-card decision below. My Schedule is assignment-focused; this does not revoke or migrate any form, recipient, answer, intake link, or established form-submission API.

## Product decisions

- Personal links, recovery and administrator controls are available to every church. Required security configuration is documented in [deployment prerequisites](../volunteer-portal-deployment.md); missing configuration fails closed and never creates fallback authority. Approval: October 21, 2026 Remove Volunteer Portal Feature Flag request.
- Phase 3 completion is an end-to-end workflow, not removal of the flag alone. An active roster member needs no account, Firebase login, human church membership or Teams permission. Volunteers with no assignments still have Time Off. Availability forms remain available through existing intake links. Temporary ingress/data failures offer an explicit retry; usable ingress remains only in memory until successful redemption or definitive denial. Background access failures keep mounted unsaved dates and provide personal-link guidance. Confirmed by the October 21, 2026 Complete and Enable Accountless My Schedule request.
- Account and accountless volunteers use the same My Schedule renderer and volunteer business operations. The server resolves church/member scope from a human session or validated personal credential; request member IDs never establish identity.
- Both identities can read their current and previous assignments and own responses, respond individually, accept all unanswered, manage time off, see conflicts and teammate display names, read permitted service details, and use applicable self-service preferences. Preserve signed-in filters, navigation, exports, history and account capabilities. Availability forms stay in their existing intake flow.
- Phase 2B adds a separate My Availability surface for recipient-scoped availability requests. Signed-in volunteers and personal-link volunteers share its interface and underlying operations, and each may access only their own authorized requests. Availability requests are not My Schedule cards. Approval: current product-owner request, 2026-11-16.
- Private notes, teammate contacts/responses, administrative data and Draft assignments are excluded. Missing schedule publication metadata retains legacy Published semantics. Publication and notification delivery remain separate.
- Accept all unanswered checks persisted responses in each schedule transaction. Existing answers survive concurrent bulk acceptance. Multi-schedule outcomes identify committed schedules and failures; retry skips completed answers.
- Both identities use Phase 1B's canonical pending-only acceptance over upcoming published primary assignments. Past occurrences, Drafts, existing answers and unrelated response metadata remain unchanged. Both clients follow bounded schedule pages and share partial-completion feedback. Personal credential/session generation and member authority are checked inside every independent schedule transaction, including retries. Confirmed by the October 21, 2026 Shared Volunteer Bulk Response fix request. Individual and legacy schedule-link responses retain explicit Accept/Decline semantics.
- My Schedule lists assigned services only. Each card shows only the volunteer's actual positions and Teams; multiple primary and shadow assignments retain their existing identities and independent response semantics. Primary assignments have direct Accept/Decline controls, answered assignments show noninteractive Accepted/Declined status with Change response, and past answers remain read-only. Availability requests and availability-only cards are not part of My Schedule. Volunteers use their existing intake links, including `/a/:token`, to submit those forms. Existing recipient records, saved answers, links, public routes and established whole-form submission endpoints remain unchanged; this decision does not migrate or delete availability data. Confirmed by the October 21, 2026 “Simplify My Schedule Cards and Share the Service Card Design” request.
- Individual Accept/Decline changes display a new confirmed answer only after the operation returns `success: true` with the same response, or an authoritative schedule refresh shows that answer. After a rejected, malformed, or ambiguous write result, refresh the schedule without resubmitting. If that refresh fails, keep the prior confirmed answer and pending count, label the attempted response unconfirmed, and offer a refresh-only retry; block bulk acceptance until the individual response is resolved. Human-session and personal-link access use the same behavior. Confirmed by the October 21, 2026 “Shared Service Card and My Schedule Reliability Improvements” request.
- Upcoming and past assigned services can be organized by month or service. Service groups use the occurrence's complete service ID set so a combined service appears once. Search and service/team filters use the assignment schedule and the volunteer's actual assignments; pending-only bulk acceptance remains separate and applies to all unanswered upcoming assignments regardless of filters. Time Off, service details and personal links remain available in their existing flows.
- Unsaved time-off drafts own their baseline dates and revision together. Refreshes, other successful actions and HTTP 409 cannot rebase a dirty draft. Conflicts preserve edits and require explicit review/discard before re-editing against current saved dates. Successful saves invalidate older page loads. Confirmed by the October 19, 2026 Final Correctness and Pilot Readiness request.
- Time Off summaries count only valid entries that have not ended in the configured church timezone, including ongoing ranges. Incomplete entries remain editable through collapse/reopen, do not increase the upcoming count, keep the separate Unsaved changes indicator, and block saving until completed or removed. Historical records and existing conflict protections remain intact for both access types. Confirmed by the October 21, 2026 Time Zone Contract Alignment and My Schedule Time Off Fix request.
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

## My Availability: Phase 2B-2 (2026-11-18)

**Approval source:** current product-owner request for Phase 2B-2, 2026-11-18.

### Before behavior

Volunteers could respond to a request through its existing form link, but had
no consolidated place to review their saved availability requests. My Schedule
remained focused on assigned services and Time Off.

### Initial behavior (current editor and groups are defined in Phase 2B-3 below)

- Signed-in volunteers open **My Availability** from the Home launcher at
  `/my-availability`. Accountless volunteers use their existing personal
  session at `/s?view=availability`; this does not require a new account or
  credential. Both entry points use the same request list and editor.
- Open requests with unanswered service dates appear under **Needs response**;
  submitted open requests appear under **Submitted responses**. Each date
  offers **Available**, **Unavailable**, or **Not answered**. An unanswered
  choice is neutral and does not count as unavailable.
- Saving sends one complete answer map for that request's occurrence scope and
  the per-occurrence revisions returned by the server. A conflict keeps the
  volunteer's draft, displays the original and latest answers for review, and
  requires an explicit choice before another save. When a network result is
  uncertain, the client reads the server state and does not blindly repeat the
  write.
- Date and time labels use the configured church service timezone when present.
  If it is missing, the service date remains visible and the time is omitted
  rather than silently substituting the browser's timezone.
- My Schedule remains assignment-only. Its existing Time Off workflow is
  unchanged and remains linked from My Availability. No schedule answer is
  required to be considered for scheduling.

### Behavior intentionally unchanged

Existing form links, submissions, recipient records, saved answers, and
revision-aware APIs remain in place. My Availability does not change blockouts,
recurring serving preferences, positions, profile data, consent, assignments,
messages, or notification behavior. Recurring availability preferences remain
deferred because there is no safe volunteer self-service read/write operation
for them in the existing server contract.

## My Availability response simplification (Phase 2B-3, 2026-11-19)

**Approval source:** Current product-owner request, “Simplify My Availability
and Correct Request Statuses,” 2026-11-19.

### Before behavior

My Availability used three choices for every service and grouped all open
requests with unanswered dates under **Needs response**. Saved answer counts
could look like a submitted response even when the request had never been
submitted, and closed requests shared the previous-responses group.

### After behavior

- A new request with no saved answers uses positive service checkboxes. Checked
  means available. Before first submission, a confirmation shows the resulting
  available and unavailable counts; submitting no checked services asks the
  volunteer to confirm they are unavailable for all services.
- For a first response containing partial legacy answers, and for any saved
  response with unanswered dates, the editor retains the three-state choices.
  Unanswered dates stay absent from the submitted map unless explicitly changed.
- Fully answered responses use checkboxes prepopulated from saved available
  answers. **Edit individual answer states** exposes Available, Unavailable and
  Not answered so a previously saved answer can be cleared. Checkbox choices
  are expanded to a complete map only when the volunteer submits.
- `respondedAt` or `submissionId` from the existing recipient-scoped read is the
  submission signal. Answer counts, opening the editor and local draft changes
  do not mark a request submitted. An accepted save response or authoritative
  read updates the visible status; a failed or uncertain write does not infer
  completion from an answer-map match alone.
- Open requests without submission metadata appear under **Needs response**;
  open requests with submission metadata appear under **Submitted responses**,
  with unanswered dates called out. Routine reads omit closed or expired
  requests. Volunteers can explicitly choose **Show past requests** to load
  read-only summaries, then open one authorized request at a time. Revoked or
  archived requests remain unavailable.
- Request cards show a compact service-date range, service count, deadline and
  accurate response summary. Full service names, dates and times remain inside
  the request and use the church timezone.

### Behavior intentionally unchanged

Both signed-in `/my-availability` and accountless `/s?view=availability` keep
their existing authorization and recipient scope. Saves still use the complete
form-scoped availability map and per-occurrence revision snapshot. HTTP 409
review, uncertain-save reconciliation, dirty-draft preservation, navigation
protection and the existing three-state backend
model and Auto-fill interpretation remain unchanged. Existing `/a/:token` links,
public positive-selection checkboxes, submissions and response APIs remain
compatible. No reminder automation or preference storage is introduced.

## Active availability reads and unified-page integration (2026-11-20)

**Approval source:** Current product-owner request, “Optimize Volunteer
Availability API and Prepare for Unified My Schedule,” 2026-11-20.

- Routine reads return only active, unarchived `team_availability` forms whose
  response deadline (or legacy form end date) has not passed on the church's
  calendar date. Recipient and current Team membership are checked under the
  server-resolved church/member identity; revoked and out-of-scope recipients
  are omitted. Open unanswered and open submitted requests remain editable.
- Expired, inactive, archived, revoked and no-longer-in-scope requests are
  omitted from volunteer reads. Their stored records and answers remain intact;
  administrative form, reporting and audit paths retain their historical
  records. There is no new volunteer history endpoint or client-controlled
  authorization bypass.
- Existing callers retain the full `requests` response by default, now scoped
  to current requests. `summary=1` returns minimal `requestSummaries` and
  scheduling preferences without occurrence projection or revision snapshots.
  A full read may include `recipientId`; the server checks that exact recipient
  against the resolved identity before loading its form details. Signed-in and
  personal-link API adapters support both options.
- Preferences remain in the availability response even when no current
  requests exist. Existing schedule data already supplies member identity,
  revision, blockout dates and service timezone. Its signed-in member object
  currently includes preference fields; the accountless member projection
  omits them. Reuse schedule data where present, and use the availability
  summary preferences for accountless access. Keep the summary operation
  independent so a delayed or failed availability read cannot hold back
  assignments. Load full request details and revision snapshots when the
  volunteer opens a summary.
- Routine full reads reconcile only returned active requests that can contain
  a matching identity; active summaries and past-request summaries skip that
  work. Opening one past request may reconcile that selected form. Closed
  history never triggers reconciliation during a routine read. If evidence is
  incomplete or conflicting, the projection retains its integrity-safe
  behavior and revision checks.
- Firestore uses bounded form and recipient queries, deduplicates forms and
  Team reads, and caps each collection's work. The required composite indexes
  are declared in `firestore.indexes.json`; deploy them before production use.
  See [the API performance record](../volunteer-availability-api-performance.md)
  for measured results and emulator limitations.

## Volunteer workspace layout and navigation (owner request, 2026-11-20)

### Before behavior

My Schedule and My Availability centered and capped the combined sidebar and
content frame. Their separate page markup had no shared collapsed-sidebar
state. Volunteer section links could change routes while Time Off or an
availability response was dirty.

### After behavior

Both pages use the same full-width workspace frame: the desktop sidebar starts
at the available workspace edge below the application header, while the main
column owns vertical scrolling and its readable-width content. The sidebar
reuses the shared sidebar surface and width, collapses to labeled icon links,
and keeps its collapsed state between the two sections. Mobile keeps the
existing drawer and fixed bottom navigation. Workspace links, app-menu links,
and browser history protect unsaved edits and block navigation during saves.

### Behavior intentionally unchanged

Availability forms retain their occurrence scopes, answers, unanswered keys,
revision snapshots, request deadlines, authorization and save semantics. Past
occurrences remain in an editable form while its server-owned deadline allows
responses. Their compact group-level past indicator does not disable editing. Time Off
continues to use its existing conflict and revision checks. No service
occurrence, form, response or schedule data is migrated by this layout change.

### Historical grouped and individual occurrences

New availability forms already omit a standalone occurrence when the saved
schedule and current service catalog prove it belongs to the same grouped
service/date. Form updates preserve issued occurrence scopes. For historical
forms, My Availability projects an exact grouped/standalone pair as one logical
card only when the current service group and a saved schedule snapshot confirm
the same church-local date and service identity. The projection is read-only:
the original form occurrence IDs, `serviceAvailability` entries and individual
revision counters remain stored. Saving from the one card writes the selected
answer through to every original ID and submits every original revision.

When the saved answers agree, or only one ID has an answer, the card displays
that answer. When the IDs contain different answers, the card does not choose
one. An editable request offers Available, Unavailable and Not answered and
requires an explicit choice before saving; a closed request stays read-only and
asks the volunteer to contact an administrator. Forms with no matching saved
schedule, missing identity evidence, a changed service group, multiple distinct
saved group memberships or incomplete schedule evidence keep the original rows
visible. Independent services on the same date remain separate. The reported
November 7/14/21/28 records are resolved only where these checks pass;
unresolved pairs stay visible for administrative review. No broad migration,
form rewrite or response-history deletion occurs.

Auto-fill continues to honor an explicit unavailable answer on the same saved
group/date when it is stored under one of that grouped service's historical
individual IDs. Unanswered responses remain neutral, and ranking behavior is
unchanged.

## Volunteer workspace consolidation and preference self-service (Phase 2B-4, 2026-11-20)

The home launcher presents one **My Schedule** card at `/my-schedule`,
described as **Assignments, availability, and time off.** The shared workspace
sidebar and mobile navigation continue to link to both My Schedule and My
Availability. Signed-in `/my-availability`, accountless `/s?view=availability`,
schedule links and existing `/a/:token` request links remain direct routes.
Time Off stays with assignments inside My Schedule.

My Availability removes the standing overview, unanswered-date and Time Off
paragraphs, routine checkbox instructions and repeated per-card past labels.
It keeps the request name/deadline, action heading, compact group-level past
counts and concise three-state guidance only when that editing mode is in use.
The shared service-occurrence grid, whole-card `Checkbox`, existing
`SegmentedControl` and design-system `Select` are reused. The first all-empty
response still requires confirmation, partial responses retain the three
states, and revision/409/uncertain-save recovery remains active.

The **Scheduling preferences** section below requests shows the member's saved
serving frequency and recurring availability, collapsed to a summary until
**Edit preferences** is selected. Saving is explicit. Signed-in and personal
link callers use self-scoped writes; the server derives the member from the
session, validates only serving frequency and recurring-week values, compares
`expectedUpdatedAt` transactionally, and updates only these two fields plus
revision/audit stamps. A stale or concurrent profile change returns 409. Drafts
remain until the volunteer reviews the latest values and explicitly keeps or
replaces them. Empty recurring-week selections still mean every week is
eligible; selected weeks remain hard scheduling eligibility rules.

General intake remains the existing onboarding and administrator-requested
form system. It may collect enabled personal details, positions, availability,
scheduling preferences, serving frequency, blockout dates and notes. Dedicated
`team_availability` forms continue to collect service-date availability. My
Availability provides recurring response editing and preference maintenance;
My Schedule provides assignments and Time Off. Existing form links, submissions,
history and review remain intact. An intake response still changes only the
enabled, explicitly submitted fields under its existing rules, so volunteers
are not asked to resubmit the whole onboarding form each month.


## Personal credential foundation: Phase 2 contract (2026-10-21)

**Approval source:** current product-owner Phase 2 request, after the explicit request to merge local `in-progress` into `in-progress-2` (merge `0ca4eb74`). This section defines the credential foundation. The broader renderer, recovery and messaging code arrived in that merge; this phase does not expand or activate those later workflows.

### Confirmed lifecycle and authority

- A bearer is 192 random bits, scoped to one authoritative church/member pair. Contact values and names never establish identity, even when shared or identical.
- Default issuance lifetime is 90 days, configurable by `AUTH_VOLUNTEER_ACCESS_DAYS`. Expiry is fixed at issuance. My Schedule reads, redemption, refresh and reuse never extend expiry or rotate a valid credential.
- `prepare(identity)` is an intentional server operation. It issues only when no current valid credential exists, otherwise returns the identical valid token and expiry. `current(identity)` recovers an existing active credential only and never issues. Neither operation belongs in ordinary page GET/bootstrap/background reads.
- A damaged, missing, wrong-key or substituted live envelope fails token recovery with an operational error. It cannot silently authorize replacement. Digest-valid authority does not depend on recovering a delivery envelope; a damaged delivery envelope does not mint a different bearer.
- Administrative revocation persists separately from credential expiry. Expiration and contact recovery cannot clear it. Only an authorized explicit restore permits new issuance. Restore never revives an old token/session. Repeated revoke/restore of the same state is idempotent.
- Intentional replacement requires a stable 16-128 character `requestKey`. A receipt under the access record binds the resulting generation/digest and actor to that operation. Retrying the same committed request returns its existing valid credential; a superseded/expired receipt returns conflict, never another rotation or resurrection. Future notification/admin workflows must retain their operation key through an uncertain response. The existing member-editor control retains only this non-secret operation ID in church/member-scoped sessionStorage through retries and editor reloads; successful lifecycle adoption clears it. No bearer/envelope enters that storage.
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

The administrator's personal-link/recovery controls are excluded from session replay, including link `href` attributes and verification fields. Default replay text masking alone does not protect link attributes. Preparation, copy, replacement and revocation provide pending and completion feedback; uncertain replacement retries retain the existing non-secret operation key.

Redemption issues a separate `__Host-worshipsync-volunteer` Secure, HttpOnly, SameSite=Strict cookie. Path `/` is required by the host prefix and prevents weaker subdomain/domain cookie injection; the credential is consumed only by volunteer APIs and never by human authentication. Its expiry cannot exceed the credential's effective expiry. A parallel human/admin browser identity never overrides the explicitly redeemed volunteer identity.

Volunteer endpoints have no-store/no-cache, no-referrer, nosniff and noindex headers and per-IP HTTP rate limits; redemption has its own narrower limit. Known preview crawlers and prefetch requests cannot redeem. Preview metadata is generic and cannot create credentials. Mutations require exact first-party Origin plus the dedicated session-derived CSRF header.

### Phase 3 integration boundary

The canonical transport identity carries `accessType: personal-volunteer-credential`, church/member, credential digest, generation, effective expiry, and a server-created `authorize(transaction)` callback. The validated session and authoritative member/state establish these fields. Bodies, phone/email and human bootstrap never select the volunteer.

`sessionIdentity` validates each request. Individual response and time-off writers call the authorizer inside the transaction that commits their existing business rules. `createVolunteerOperations.acceptPendingAssignments` now supports the same trusted authorizer **inside every independent schedule transaction**, and stops remaining work on authority loss. Both HTTP identities pass it through and share per-schedule outcomes, pagination and the existing My Schedule renderer/rules. Permitted read projections remain explicit: own assignments/responses/time off, teammate display names and volunteer-safe service details; no contacts, teammate responses, private notes, Drafts, administrative controls or unrestricted nested loaders.

The October 21, 2026 standard-feature decision supersedes the earlier Phase 2 activation restriction. Portal, recovery and administrator endpoints have no feature gate. The dedicated security secret, lifetime validation, Firestore authority and administrator/session authorization remain required. No deployment or real delivery is authorized by this code change.

### Remaining decisions and verification limits

No unresolved product choice blocks Phase 3. It uses the existing verified recovery workflow and credential-bounded session policy. Production configuration, provider readiness and operational verification remain separate, as documented in [deployment prerequisites](../volunteer-portal-deployment.md). Live Heroku access is excluded from this code task. Fragment ingress deliberately does not rely on proving path-log suppression. Local browser checks do not certify production log-body settings, physical-device behavior or deployed Firestore IAM/indexes.

## Phase 3 completion evidence

The existing operator member editor and public MySchedule run through the built browser entries and real HTTP/Firestore in the [completion review](../volunteer-portal-phase-3-completion-review.md). Coverage includes admin preparation/copy/reuse/replacement/revocation, a desktop personal visit with human admin credentials present, a fresh mobile accountless visit, current/past assignments across Teams, search/filters, permitted nested plans/PDF, individual and partial/retried bulk responses, dirty date conflicts, lost save success, no-assignment self-service, new-tab session restoration, verified expired recovery and archived/deleted member rejection. No second renderer, privileged supporting API or automatic delivery is introduced.
