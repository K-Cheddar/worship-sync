# Feature Contract: Availability form text messages

**Contract status:** Confirmed product intent

**Approval source:** Current task request dated 2026-10-22; it supersedes the duplicate-send decision confirmed on 2026-10-12. The later Messages redesign request on 2026-10-22 moves the availability composer exclusively to Forms.

**Last reviewed:** 2026-10-22

## Purpose

Let an authorized church administrator or team editor prepare and send a monthly availability form request by text message, with each volunteer receiving their own secure response link.

## Operator workflow

Existing `team_availability` forms open a full-width workspace with one **Volunteers** section. Each in-scope volunteer appears once with request progress, delivery context and an availability summary. Submitted answers expand inline. Search, request/response status and Team filters apply to the list; large rosters use pagination. Personal links, revocation and request history remain in each volunteer's menu. **View availability by date** opens a focused comparison with a service-date selector, Team filter, available/unavailable/incomplete counts and an optional horizontally scrollable matrix. Administrators retain submission processing under a collapsed section. General links are available in the header menu only to users authorized for that endpoint.

Administrators also use this workspace for supported legacy/general-intake forms whose resolved enabled fields include service-date availability and which have saved availability occurrences or service selections. This presentation classification ignores names and never changes persisted purpose. General-intake editing, extra fields, public links, public submissions, member matching and administrative processing remain intact; unlinked public submissions stay in the separate collapsed submission review below the volunteer list and are not counted as personal responses. Missing occurrence snapshots may be derived for display from existing services and the church time zone without persisting them. Ordinary intake forms without enabled service-date availability retain their existing workflow. Team-scoped authorization continues to require the server's explicit `team_availability` purpose; this display rule does not broaden access.

The compact form header uses the shared primary CTA style for **Send requests**. Directly below it, **Responded**, **Awaiting response** and **Not invited** counts and one completion bar summarize the unfiltered in-scope roster; **Refresh status** lives in that summary. History-dependent invitation counts remain unknown while loading. One compact, searchable and filterable volunteer list follows. A missing answer remains visible as **No answer** only in that volunteer's expanded response or the date comparison; people who have not responded show a dash in the main list.

From the selected active availability form, **Send requests** opens one two-step dialog with three audience presets: **Not yet contacted** (default), **Haven't responded**, and **Choose people**. The first selects eligible volunteers with no provider-accepted or uncertain message for the form; a definitive failed attempt remains eligible. The second selects eligible nonresponders, including those already contacted. **Choose people** allows an administrator to deliberately select anyone eligible, including previously contacted volunteers and people who already responded. Previously contacted people are never automatically selected in that preset. A row menu offers **Resend link** for an active, nonrevoked personal request and opens this same dialog with that volunteer selected. All presets use one preparation, exact-message review, authorization and dispatch flow. The review shows selected and sendable counts, exclusions, exact personalized messages, masked destinations, text estimates and prior-send context. A previous uncertain outcome requires explicit acknowledgment before a separate new message; **Check message status** remains available for the original operation. Only the final **Send X messages** action dispatches; **Cancel** never sends. Messages uses this same batch workflow and retains advanced delivery history.

## Expected behavior

- **Not yet contacted:** Eligible active members in form scope with no provider-accepted or uncertain message are automatically selected. A definitive provider rejection or other confirmed pre-send failure does not count as a prior contact and remains eligible.
- Members who have not agreed to receive text messages, lack a valid phone number, opted out, are archived, or are outside form scope remain ineligible in every audience. A revoked response link is never restored to send another message.
- **Haven't responded:** Eligible nonresponders are automatically selected, including volunteers with earlier accepted, failed or uncertain messages. A separate message after an uncertain outcome requires a deliberate duplicate-risk acknowledgment.
- **Choose people:** The operator can deliberately select any eligible volunteer, including previously contacted people or someone who already responded, provided current form, roster, recipient, consent and phone checks still pass. Every new operation has a batch-derived notification identity; the original intent and provider evidence remain unchanged.
- The operator can add or remove eligible members. Filtering and searching do not change selection. An explicit deselection stays in effect when consent or other eligibility data refreshes.
- Recipient selection and batch preparation do not send messages. The **Review and send** action opens the confirmation directly; sending still requires the operator's final explicit confirmation for that reviewed batch.
- The confirmation identifies selected volunteers who cannot receive a message, separates the number of volunteers from the estimated number of texts, and explains when a personalized message counts as more than one text. Message details remain expandable so a large group is easy to review.
- Each message uses the existing private response link for that member and form. Existing response records and links remain valid; volunteers do not need WorshipSync accounts.
- If multiple selected members share a phone number, review shows the shared destination while retaining separate messages and private response links for each member.
- A provider-accepted request is not automatically selected again by **Not yet contacted**. A separate deliberate message uses a new operation identity and preserves every previous intent and delivery record. An uncertain result is excluded from **Not yet contacted**, shown in other applicable audiences, and requires explicit acknowledgment before dispatch. The same uncertain operation stays fenced and is never automatically retried.
- Opening Send form refreshes the complete current-form message and delivery history. Recipient selection and review stay disabled until that refresh succeeds; stale responses cannot replace a newer snapshot.
- Consent and phone eligibility are checked again by the server at send time. Existing form scope, recipient identity, response, consent, durable claim, approval-version, idempotency, and STOP protections remain authoritative.
- Creating or editing a form, recording consent, opening the workflow, and preparing a batch do not send text messages. Automatic sends remain disabled. New preparations do not increment a form-wide reminder counter.
- A CSRF rejection is checked before dispatch side effects. The authenticated API refreshes the session and retries the same reviewed operation once. If recovery fails, the prepared batch remains available for retry; if the outcome is ambiguous, the UI checks the persisted batch before offering another operation.
- Prepared operations can be restored after refresh and, when present in persisted intent history, from another authorized session. Repeating the same batch remains idempotent; a new review creates a separate operation. An abandoned preparation does not block a separate new operation.
- Forms retains availability preparation, review, confirmation and dispatch. Messages shows authorized availability history alongside other outbound SMS, without a form-specific composer.

## Behavioral boundaries

- This workflow does not add bulk consent recording, automatic reminders, scheduled jobs, or a new notification system.
- A team-scoped editor must not be able to send to unrelated teams through this workflow. Existing authorization behavior is preserved.
- Selection is constrained to the form's selected teams; an empty team list retains the server's existing all-team form semantics.
- **Not yet contacted** does not automatically select provider-accepted or uncertain messages. A deliberate new operation creates a new notification identity while preserving same-operation idempotency and every previous delivery record. Reminder-round fields remain available for historical records and do not restrict new operations.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| Normal workflow | Eligible volunteers in the default audience are preselected. One **Review and send** action prepares and opens the detailed confirmation; only the final **Send** action sends. Cancel returns to selection without sending. | `AvailabilityFormSendFlow.test.tsx`; `TeamsMessagesPage.test.tsx`; `notificationIntents.test.js` | Confirmed by current request; implemented |
| Repeated or explicit action | The default omits provider-accepted and uncertain history; nonresponders can include prior contacts; Choose people includes respondents. Each new operation has a new intent while preserving the original send evidence. | Resend identity, same-operation retry, uncertainty acknowledgment and reminder compatibility regressions in `notificationIntents.test.js`; `availabilityRecipientSelection.test.ts`; claim guards in `server/notificationIntents.js` | Current task request dated 2026-10-22; implemented |
| Failed send retry | Definitive failures remain eligible in **Not yet contacted** because the provider did not accept the message. | `AvailabilityFormSendFlow.test.tsx`; `availabilityRecipientSelection.test.ts`; `notificationIntents.test.js` | Current task request dated 2026-10-22; implemented |
| Manual change | Eligible recipients can be unchecked or added; filters preserve selection and explicit unchecks survive eligibility refresh. | `AvailabilityFormSendFlow.test.tsx`; `TeamsMessagesPage.test.tsx` | Confirmed by current request; implemented |
| Missing, incomplete, or unavailable data | Consent and full form message history must load before recipients can be selected or reviewed. | `availabilityNotificationHistory.test.ts`; Forms and Messages flow tests | Confirmed by current request; implemented |
| Error or recovery | A CSRF rejection is safely retried after session refresh; a still-prepared batch remains available for the same operation. Unknown outcomes remain fenced; a separate new operation requires a visible warning and acknowledgment. Progress and results come from the persisted batch and delivery history. | `notificationIntents.test.js`; `AvailabilityBatchReview.test.tsx`; `TeamsMessagesPage.test.tsx`; `auth.test.ts` | Current task request dated 2026-10-22; implemented |
| Shared phone number | Review identifies the common destination and still shows each member's separate private message. | `AvailabilityBatchReview.test.tsx`; server recipient and response-link tests in `teamsApi.test.js` | Confirmed by current request; implemented |

## Product decisions

- **Question/problem:** How should availability form management expose recipient progress, responses and sending?
- **Approved behavior:** One Volunteers list combines request progress and current recipient-linked availability, with answers expanded inline. A focused **View availability by date** comparison is secondary, and an optional full matrix stays inside that view. The three progress callouts and bar continue to summarize the unfiltered in-scope roster. Unlinked public submissions remain in the collapsed legacy submission review. Prepared messages and newly created links alone do not establish a sent invitation. Copied personal links establish sharing; provider acceptance is not confirmed delivery. Team-scoped users retain the restricted response projection and cannot obtain general form links.
- **Approval source/date:** Current availability UX redesign request, 2026-10-21; existing authorization contract for general form links.
- **Supersedes:** The two-tab presentation approved earlier on 2026-10-21.
- **Unchanged boundaries:** Consent/STOP, same-operation idempotency, uncertainty warnings, approval snapshots, message content, private links, form editing and My Schedule credentials.

- **Question/problem:** Should a form request whose SMS was already confirmed sent be selectable for another manual send?
- **Historical behavior, superseded 2026-10-22:** A provider-accepted request was permanently blocked from another send.
- **Current approved behavior:** Administrators can deliberately select a previously contacted volunteer in **Haven't responded** or **Choose people**, or open **Resend link** from that volunteer's row. The server creates a new durable intent for that reviewed operation while preserving same-operation retry fences and prior delivery history. An uncertain prior result requires explicit acknowledgment for the new operation.
- **Approval source/date:** Current task request, 2026-10-22; supersedes the product-owner decision dated 2026-10-12.
- **Affected workflow/contract:** Availability form SMS in Forms and Messages. Schedule SMS identities and dispatch behavior are unchanged.

- **Question/problem:** How many actions should remain after form and volunteer selection?
- **Approved behavior:** One **Review and send** action prepares the reviewed batch and opens the confirmation; one final **Send** action sends it. Preparation never sends, and Cancel returns to selection.
- **Why:** Keep a clear final confirmation while removing an intermediate Send action that only opened the confirmation.
- **Material alternative rejected:** Keep the separate review panel and require its Send button before opening the confirmation.
- **Approval source/date:** Current task request, 2026-10-13.
- **Affected workflow/contract:** Availability form text messages in Forms and Messages.

- **Question/problem:** Should definitively failed form requests be included in the default recipient selection?
- **Historical behavior, superseded 2026-10-22:** Definitively failed requests stayed unchecked until the operator deliberately selected them.
- **Current approved behavior:** A definitive failure is not a previous contact, so the default **Not yet contacted** audience may select it again after fresh preparation and review. An uncertain outcome stays excluded from the default and requires explicit duplicate-risk acknowledgment for a separate new message.
- **Approval source/date:** Current task request, 2026-10-22.
- **Affected workflow/contract:** Availability form SMS in Forms.

## Implementation references

- Entry point: `client/src/pages/Teams/managers/IntakeManager.tsx`
- Implementation: `client/src/pages/Teams/components/AvailabilityFormWorkspace.tsx`, `client/src/pages/Teams/components/AvailabilityVolunteersList.tsx`, `client/src/pages/Teams/components/AvailabilityDateComparison.tsx`, `client/src/pages/Teams/components/AvailabilityFormSendFlow.tsx`, `client/src/pages/Teams/components/AvailabilityBatchReview.tsx`, `client/src/pages/Teams/availabilityFormProgress.ts`, `client/src/pages/Teams/availabilityRecipientSelection.ts`, `client/src/pages/Teams/availabilityNotificationHistory.ts`, `client/src/pages/Teams/pages/TeamsMessagesPage.tsx`, `server/notificationIntents.js`, `server/teamsAuthHandlers.js`
- Tests: `client/src/pages/Teams/pages/TeamsFormsPage.workspace.test.tsx`, `client/src/pages/Teams/managers/IntakeManager.test.tsx`, `client/src/pages/Teams/availabilityFormProgress.test.ts`, `client/src/pages/Teams/components/AvailabilityFormSendFlow.test.tsx`, `client/src/pages/Teams/components/AvailabilityBatchReview.test.tsx`, `client/src/pages/Teams/availabilityRecipientSelection.test.ts`, `client/src/pages/Teams/availabilityNotificationHistory.test.ts`, `client/src/pages/Teams/pages/TeamsMessagesPage.test.tsx`, `server/notificationIntents.test.js`, `server/teamsApi.test.js`

## Technical design notes (separate from product requirements)

Forms and Messages load every page of notification intents plus the form's SMS delivery attempts before allowing selection. Recipient eligibility is shared through `getAvailabilityRecipientRows`; batch preparation and dispatch continue through the existing notification intent API.

The [SMS foundation audit and architecture](../sms-foundation-architecture.md) records the shared batch boundary, state/approval/idempotency rules, current recovery and authorization gaps, hosting options, and the unimplemented schedule SMS integration contract. `server/notificationBatches.js` now provides feature-independent review identity, approval transition, dispatch selection and result aggregation; availability adapters keep form/recipient validation and API formatting. Send claims checkpoint their delivery attempt ID before provider work. Batch recovery checks church, batch and feature ownership before mutating stale intents.

The operator flow presents review content in the existing confirmation modal: preparing a batch opens that modal, and only its final Send action dispatches messages. All audience presets use the same batch operation. A new review reserves a new batch and intent identity, while retries of that same operation retain their idempotency key. Messages history selects recipients for this same batch workflow; no standalone availability SMS send path remains.

Dispatch remains synchronous and request-bound in this phase. The extraction does not establish reliable background execution, multi-number inbound mapping or complete team-scoped messaging authorization. The current manual-send decision above remains authoritative; the product owner selected existing-web-dyno continuation and one message per volunteer per schedule for future work on 2026-10-12. Those decisions and the intended week-before reminders are recorded in the architecture document; reminder sending remains explicitly reviewed and operator-approved. No new execution behavior is implemented in this phase.

## Delivery reliability decision (Phase 2, 2026-10-12)

The current Phase 2 request authorizes shared monotonic reconciliation of send results, recovery and authenticated callbacks. Confirmed provider evidence is retained after persistence failure and used to repair the intent; accepted and uncertain sends stay blocked from another claim within that same notification intent. Recovery rechecks current claim ownership transactionally. New sends bind signed callbacks to an opaque persisted attempt token, allowing acceptance evidence before SID persistence; old data requires no migration and unattributable outcomes remain blocked. An older accepted attempt permanently fences further claims for that intent. Any separately reviewed new availability operation creates a separate intent and does not reset the prior fence. Consent, message text, private links, current permissions and history remain preserved. See [the authoritative delivery lifecycle](../sms-foundation-architecture.md#phase-2-delivery-reliability-contract-authoritative).
