# Feature Contract: Personalized team intake profile completion

**Contract status:** Confirmed product intent

**Approval source:** Current user request dated 2026-10-23

**Last reviewed:** 2026-10-23

## Purpose

Let a volunteer complete supported personal details that are missing from their linked roster member while responding through the existing personalized intake form.

## Operator workflow

A volunteer opens their recipient-bound link and sees the existing form. Enabled personal-information inputs appear only for fields that are empty or missing on their roster member. The volunteer submits the form once; the response and newly supplied details are saved to that linked member.

## Expected behavior

- The personalized preview returns an allowlisted list of missing supported fields, not the member's existing profile values. Its existing first-name greeting remains.
- The public form displays an existing personal-information input only when the form enables it and the preview says the linked member is missing it. It renders no personal-information section when no enabled personal field is missing.
- Submission accepts only enabled fields that remain missing on the current member. It uses existing normalization and validation, ignores blank values, and does not replace populated fields.
- The same behavior applies to recipient-bound `general_intake` and `team_availability` links. Existing availability forms remain availability-only under their current form rules; empty personal inputs do not block those responses.
- Firestore transaction and fallback writes update the linked roster member. Adding an email keeps its contact index current.
- Non-personalized forms retain their existing field visibility and submission behavior.

## Behavioral boundaries

- Recipient token identity, membership scope, authorization, and form response behavior remain authoritative.
- This change does not add a profile editor, endpoint, phone-number collection, or SMS consent behavior.
- Availability responses, positions, scheduling preferences, blockout dates, notes, and other existing submission behavior remain unchanged.
- Broader public service, schedule, and team access behavior remains outside this contract.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| Complete member profile | Personalized preview reports no missing fields and the form hides personal inputs. | `TeamIntakePublic.test.tsx`; `teamsApi.test.js` | Confirmed by current request |
| Partial member profile | Only enabled missing fields appear; disabled and populated fields stay hidden. | `TeamIntakePublic.test.tsx`; `teamsApi.test.js` | Confirmed by current request |
| Information saved | New details update the member named by the recipient link and update the email contact index. | `teamsApi.test.js`; `teamIntakeTransactionDigest.test.js` | Confirmed by current request |
| Concurrent member edit | A value filled before commit is preserved when the personalized response commits. | `teamIntakeTransactionDigest.test.js` | Confirmed by current request |
| Blank personal inputs on availability form | Availability submission succeeds and existing profile values remain. | `TeamIntakePublic.test.tsx`; `teamIntakeTransactionDigest.test.js` | Confirmed by current request |
| Public form | Enabled personal fields retain their existing behavior. | `TeamIntakePublic.test.tsx` | Confirmed by current request |

## Product decisions

- **Data-integrity clarification (2026-11-10 request):** Disabled or entirely
  omitted response fields preserve existing member values. Server form enablement
  remains authoritative when processing older responses. Enabled, explicitly
  submitted empty positions or blockouts still clear their existing scope.
  An explicitly submitted availability map is a complete replacement for the
  form's occurrence IDs, including an empty map; dates outside the form remain
  unchanged. Omitting the whole map preserves saved answers. Availability-only
  forms continue to update availability and missing personal details only.
  Identical completed recipient requests return the existing response identity
  without reapplying member edits. See the [audit](../intake-data-integrity-audit.md).

- **Question/problem:** Personalized links hid profile inputs even when the linked roster member lacked those values.
- **Approved behavior:** Show enabled missing fields within the existing form and save nonblank, still-missing values to the linked member without replacing populated values.
- **Why:** Volunteers can complete missing information while responding without a separate profile workflow.
- **Material alternative rejected:** Ask volunteers to leave the response flow and open a separate profile editor.
- **Approval source/date:** Current user request, 2026-10-23.
- **Affected workflow/contract:** Personalized team intake responses; broader public access remains inventory-only.

## Implementation references

- Entry point: `client/src/public/PublicApp.tsx`, `client/src/App.tsx`; `server.js`
- Implementation: `client/src/pages/Teams/TeamIntakePublic.tsx`, `client/src/api/authTypes.ts`, `server/teamsAuthHandlers.js`
- Tests: `client/src/pages/Teams/TeamIntakePublic.test.tsx`, `server/teamsApi.test.js`, `server/teamIntakeTransactionDigest.test.js`

## Reusable form defaults (Phase 2A)

Approved by the November 11, 2026 Phase 2A request. Church administrators and
church-wide Teams editors can choose **Save as default** inside the existing
form editor. General intake defaults include enabled fields and welcome,
positions, availability and notes wording. Team availability defaults include
welcome and availability wording only. Empty messages use built-in wording.

Manual creation and new suggestions copy the matching church defaults. Dates,
Teams, services and occurrences come from the existing creation workflow.
Suggestion updates retain the existing form's purpose and settings. Saving
preferences never creates or edits a form, member, response or recipient link.
Availability-only forms remain restricted to service-date availability.

Defaults use the existing church document (`intakeFormDefaults`) with independent
purpose revisions (`intakeFormDefaultsRevisions`). Authenticated GET/POST
`/api/churches/:churchId/team-intake/defaults` applies existing Teams authorization;
team-scoped editors can read and use preferences but cannot save them. Writes
validate an allowlist and 500-character message limit, then compare the submitted
revision in a Firestore transaction. Conflicts return 409. Other purposes and
unrelated church settings survive. The development memory store serializes church
settings writes; it is process-local and volatile, as before.

Creation waits for preferences to load successfully. A failed load offers retry;
existing forms remain editable. Preferences are copied once on creation, so
reloads and save acknowledgments never replace a draft. Reload defaults refreshes
the cached preferences and revisions while keeping the draft. A church switch
retires the editor and ignores its late reads and save results. Existing unsaved
form edits retain the navigation guard.

No default templates, local storage, production migration, prefilling, editable
responses, reminder automation or new dispatch behavior is introduced.

## Editable availability responses (Phase 2B-1)

Approved by the current product-owner request, 2026-11-16. This phase adds the
backend contract for reviewing and safely updating service-date availability;
the initial separate My Availability interface was Phase 2B-2. The November 22,
2026 unified-workspace decision supersedes that page separation; the API and
recipient-scoped write contract remain unchanged.

### Before behavior

Availability is stored on `teamRosterMembers.serviceAvailability`, but response
maps have no cross-form revision check. An old form can replace a newer answer
for an occurrence shared with another form. The signed-in and accountless
availability reads do not return saved answers or an edit precondition.

### After behavior

- `GET /api/churches/:churchId/my-availability` and
  `GET /api/volunteer/availability` use the same recipient-scoped business logic
  and return the current user's active and read-only availability requests,
  form/recipient identity, occurrence answers, unanswered occurrence IDs,
  response deadline, editability, response state and per-occurrence revision.
- `POST` to either existing route accepts an explicit complete map for that
  form's occurrence scope. `available` and `unavailable` are the only accepted
  answers. A missing key clears that occurrence to unanswered; an omitted map
  leaves availability unchanged. Answers outside the form scope and unrelated
  roster fields are preserved.
- `teamRosterMembers.serviceAvailability` remains the canonical saved-answer
  map. `serviceAvailabilityRevisions` stores server-owned counters by occurrence
  on the same member document. Every write path that changes occurrence answers
  advances the affected counter. A stale scope returns HTTP 409 with a reload
  instruction; unrelated fields and disjoint occurrence edits survive.
- Administrative member updates require `expectedUpdatedAt`; when they include
  `serviceAvailability`, the complete top-level map and its changed-occurrence
  revisions commit in the same Firestore transaction. Only changed occurrence
  answers advance revisions. Omitting the map preserves both availability maps.
- The stable recipient and deterministic submission identity remain in use.
  The submitted revision is included in the existing response digest, so an
  identical retry after commit returns the committed response, while a later
  deliberate edit with a fresh revision is distinct. No operation ledger or
  second availability store is added.
- The existing recipient preview returns only the form-scoped revision map.
  Current public clients send it as a hidden precondition. Deployed clients that
  omit it retain the revision-zero compatibility path; once a newer edit has
  advanced an occurrence, those stale requests conflict rather than overwrite.
- Availability requests remain optional. An unanswered request is unknown,
  not available or unavailable. Auto-fill continues to include unanswered
  volunteers and excludes explicit unavailability under its existing rules.

### Behavior intentionally unchanged

Existing forms, recipients, response IDs and links remain in place. The form's
deadline, active status, Team scope, identity checks and complete-replacement
semantics remain authoritative. No recurring preference, blockout, position,
profile, consent or schedule field is changed by an availability-only response.
Availability writes do not activate SMS, send email, schedule reminders or
change Auto-fill ranking. My Schedule remains assignment-focused; no new UI,
form system, collection, identity model or migration is introduced in this
phase.

## My Availability (Phase 2B-2, 2026-11-18; historical page layout superseded)

At that milestone, the separate volunteer UI was available at `/my-availability`
to signed-in humans and at `/s?view=availability` through an existing
accountless personal session. The November 22 unified-workspace decision keeps
these routes as compatibility entry points that focus the availability section
inside My Schedule.
It lists the volunteer's own open requests that still have unanswered dates,
followed by answered or closed requests. Each occurrence supports Available,
Unavailable, and Not answered; the last choice stays absent from the complete
submitted map so it remains neutral.

Saving uses the Phase 2B-1 recipient-scoped complete-map endpoint and its
per-occurrence revision snapshot. A 409 retains the draft and requires explicit
review of the original, current, and draft answers before rebasing. Uncertain
write outcomes are reconciled by reading the authoritative endpoint, without
automatic resubmission. The read includes the validated church service timezone
for display. At the time, Time Off stayed on assignment-focused My Schedule and
recurring preferences were deferred; later preference self-service and the
unified layout are documented in the My Schedule contract.

## My Availability response simplification (Phase 2B-3; editor behavior retained)

Confirmed by the current product-owner request, “Simplify My Availability and
Correct Request Statuses,” 2026-11-19. The availability section now uses
positive checkboxes for a new, fully unanswered response and confirms the
available/unavailable totals before the existing submit API is called. An
explicitly confirmed all-unavailable response is a submission. Existing
unanswered values remain distinct: mixed or partial data keeps the existing
Available / Unavailable / Not answered editor, and fully answered responses
can open that editor to clear a saved answer.

The existing recipient `respondedAt` / `submissionId` metadata determines
whether a request has been submitted. At that milestone, the page grouped
requests as **Needs response**, **Submitted responses**, or **Closed**. The
unified workspace now shows compact active request cards in one section and
keeps the same editor behavior after a card is opened. The existing complete
form-scoped map, per-occurrence revisions, recipient authorization, and 409
recovery remain the write contract. Public `/a/:token` forms keep their
original positive-selection checkbox meaning and established submission
behavior. No new availability storage, reminder, or dispatch behavior is added.

## Volunteer workspace responsibilities (Phase 2B-4, 2026-11-20)

Use general intake primarily for onboarding and administrator-requested
updates to personal information, positions, service-date availability,
scheduling preferences, serving frequency, blockout dates and notes. Dedicated
`team_availability` forms request service-date availability only. Volunteers
use My Availability for recurring availability responses and maintaining their
saved serving frequency and recurring-week eligibility settings; My Schedule
is for assignments and Time Off. Existing general intake links, submissions,
history and review remain available. A monthly availability request does not
require a volunteer to resubmit unrelated intake fields. Each workflow keeps
its existing field-scoped update behavior; saving availability or scheduling
preferences does not overwrite personal details, notes, blockouts or
assignments.
