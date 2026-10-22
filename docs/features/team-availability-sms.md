# Feature Contract: Availability form text messages

**Contract status:** Confirmed product intent

**Approval source:** Current task request dated 2026-10-13; duplicate-send decision confirmed by the product owner in this conversation on 2026-10-12.

**Last reviewed:** 2026-10-21

## Purpose

Let an authorized church administrator or team editor prepare and send a monthly availability form request by text message, with each volunteer receiving their own secure response link.

## Operator workflow

Existing `team_availability` forms open a full-width workspace with one **Volunteers** section. Each in-scope volunteer appears once with request progress, delivery context and an availability summary. Submitted answers expand inline. Search, request/response status and Team filters apply to the list; large rosters use pagination. Personal links, revocation and request history remain in each volunteer's menu. **View availability by date** opens a focused comparison with a service-date selector, Team filter, available/unavailable/incomplete counts and an optional horizontally scrollable matrix. Administrators retain submission processing under a collapsed section. General links are available in the header menu only to users authorized for that endpoint.

Administrators also use this workspace for supported legacy/general-intake forms whose resolved enabled fields include service-date availability and which have saved availability occurrences or service selections. This presentation classification ignores names and never changes persisted purpose. General-intake editing, extra fields, public links, public submissions, member matching and administrative processing remain intact; unlinked public submissions stay in the separate collapsed submission review below the volunteer list and are not counted as personal responses. Missing occurrence snapshots may be derived for display from existing services and the church time zone without persisting them. Ordinary intake forms without enabled service-date availability retain their existing workflow. Team-scoped authorization continues to require the server's explicit `team_availability` purpose; this display rule does not broaden access.

The compact form header uses the shared primary CTA style for **Send requests**. Directly below it, **Responded**, **Awaiting response** and **Not invited** counts and one completion bar summarize the unfiltered in-scope roster; **Refresh status** lives in that summary. History-dependent invitation counts remain unknown while loading. One compact, searchable and filterable volunteer list follows. A missing answer remains visible as **No answer** only in that volunteer's expanded response or the date comparison; people who have not responded show a dash in the main list.

From the selected active availability form, **Send requests** opens one dialog with **Select recipients** and **Review and send** steps. The operator reviews automatically selected first-time volunteers and optionally adjusts selection using team, name and recipient filters. The initial audience view shows eligible first-time recipients without changing selection rules; **Specific members** exposes previous failures and blocked recipients. Eligibility diagnostics remain collapsed until requested. **Continue to review** prepares the batch and replaces selection with the exact message review in that same dialog. Review shows selected versus server-eligible counts, exclusions, segment estimates and warnings; individual message details are expandable, with a single eligible message expanded initially. Footer actions stay visible on small screens. Only the final **Send** with the server-eligible message count sends. **Back** preserves selection; **Cancel** closes without sending. Concise results remain visible in the dialog and refreshed recipient history. Other intake types and advanced Messages workflows retain their existing selection and sending behavior.

## Expected behavior

- Eligible, active members in the form's selected team scope with no prior request are selected automatically. A definitively failed request remains eligible but starts unselected; the operator must choose it to retry.
- Members who have not agreed to receive text messages, lack a valid phone number, opted out, are archived or outside the form's team scope, already responded, or already received the request are not selectable.
- The operator can add or remove eligible members. Filtering and searching do not change selection. An explicit deselection stays in effect when consent or other eligibility data refreshes.
- Recipient selection and batch preparation do not send messages. The **Review and send** action opens the confirmation directly; sending still requires the operator's final explicit confirmation for that reviewed batch.
- The confirmation identifies selected volunteers who cannot receive a message, separates the number of volunteers from the estimated number of texts, and explains when a personalized message counts as more than one text. Message details remain expandable so a large group is easy to review.
- Each message uses the existing private response link for that member and form. Existing response records and links remain valid; volunteers do not need WorshipSync accounts.
- If multiple selected members share a phone number, review shows the shared destination while retaining separate messages and private response links for each member.
- Provider-accepted requests remain blocked from resend, including attempts later reported undelivered. A definitively rejected delivery can be selected again after the operator reviews its history. An uncertain or in-progress outcome stays blocked and is never retried automatically.
- Opening Send form refreshes the complete current-form message and delivery history. Recipient selection and review stay disabled until that refresh succeeds; stale responses cannot replace a newer snapshot.
- Consent and phone eligibility are checked again by the server at send time. Existing form scope, recipient identity, response, consent, durable claim, approval-version, idempotency, and STOP protections remain authoritative.
- Creating or editing a form, recording consent, opening the workflow, and preparing a batch do not send text messages. Automatic sends remain disabled.
- Forms is the primary location for sending a form request. Messages may continue to provide advanced message management and history. Individual sends in Messages remain a separate advanced action; sending one updates related batch status and message history from the server.

## Behavioral boundaries

- This workflow does not add bulk consent recording, automatic reminders, scheduled jobs, or a new notification system.
- A team-scoped editor must not be able to send to unrelated teams through this workflow. Existing authorization behavior is preserved.
- Selection is constrained to the form's selected teams; an empty team list retains the server's existing all-team form semantics.
- The duplicate-send decision applies to a confirmed, provider-accepted request. There is no manual resend override for it.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| Normal workflow | Eligible first-time volunteers in form scope are preselected. One **Review and send** action prepares and opens the detailed confirmation; only the final **Send** action sends. Cancel returns to selection without sending. | `AvailabilityFormSendFlow.test.tsx`; `TeamsMessagesPage.test.tsx`; `notificationIntents.test.js` | Confirmed by current request; implemented |
| Repeated or explicit action | Provider-accepted requests stay excluded, including later undelivered attempts; uncertain sends cannot be retried automatically. | Duplicate-send regression in `notificationIntents.test.js`; `availabilityRecipientSelection.test.ts`; intent claim and dispatch guards in `server/notificationIntents.js` | Duplicate-send decision confirmed on 2026-10-12; implemented |
| Failed send retry | Definitive failures are available for deliberate selection and do not join first-time recipients in the automatic selection. | `AvailabilityFormSendFlow.test.tsx`; `availabilityRecipientSelection.test.ts` | Confirmed by current request dated 2026-10-12; implemented |
| Manual change | Eligible recipients can be unchecked or added; filters preserve selection and explicit unchecks survive eligibility refresh. | `AvailabilityFormSendFlow.test.tsx`; `TeamsMessagesPage.test.tsx` | Confirmed by current request; implemented |
| Missing, incomplete, or unavailable data | Consent and full form message history must load before recipients can be selected or reviewed. | `availabilityNotificationHistory.test.ts`; Forms and Messages flow tests | Confirmed by current request; implemented |
| Error or recovery | Definitive failures are visible and may be deliberately selected for retry; unknown outcomes require history review and are not automatically retried. Progress and results are refreshed from server batch and delivery history. | `notificationIntents.test.js`; `AvailabilityBatchReview.test.tsx`; `TeamsMessagesPage.test.tsx` | Confirmed by current request; implemented |
| Shared phone number | Review identifies the common destination and still shows each member's separate private message. | `AvailabilityBatchReview.test.tsx`; server recipient and response-link tests in `teamsApi.test.js` | Confirmed by current request; implemented |

## Product decisions

- **Question/problem:** How should availability form management expose recipient progress, responses and sending?
- **Approved behavior:** One Volunteers list combines request progress and current recipient-linked availability, with answers expanded inline. A focused **View availability by date** comparison is secondary, and an optional full matrix stays inside that view. The three progress callouts and bar continue to summarize the unfiltered in-scope roster. Unlinked public submissions remain in the collapsed legacy submission review. Prepared messages and newly created links alone do not establish a sent invitation. Copied personal links establish sharing; provider acceptance is not confirmed delivery. Team-scoped users retain the restricted response projection and cannot obtain general form links.
- **Approval source/date:** Current availability UX redesign request, 2026-10-21; existing authorization contract for general form links.
- **Supersedes:** The two-tab presentation approved earlier on 2026-10-21.
- **Unchanged boundaries:** Consent/STOP, duplicate-send blocks, explicit definitive-failure retries, uncertainty handling, approval snapshots, message content, private links, form editing and My Schedule credentials.

- **Question/problem:** Should a form request whose SMS was already confirmed sent be selectable for another manual send?
- **Approved behavior:** Keep the existing duplicate-send block; show the member as already sent and prevent reselection.
- **Why:** Preserve the existing server-side duplicate-send protection as explicitly requested.
- **Material alternative rejected:** Add a deliberate manual resend path.
- **Approval source/date:** Product-owner reply to the clarification question in this conversation, 2026-10-12.
- **Affected workflow/contract:** Availability form SMS, in Forms and the shared Messages recipient selector.

- **Question/problem:** How many actions should remain after form and volunteer selection?
- **Approved behavior:** One **Review and send** action prepares the reviewed batch and opens the confirmation; one final **Send** action sends it. Preparation never sends, and Cancel returns to selection.
- **Why:** Keep a clear final confirmation while removing an intermediate Send action that only opened the confirmation.
- **Material alternative rejected:** Keep the separate review panel and require its Send button before opening the confirmation.
- **Approval source/date:** Current task request, 2026-10-13.
- **Affected workflow/contract:** Availability form text messages in Forms and Messages.

- **Question/problem:** Should definitively failed form requests be included in the default recipient selection?
- **Approved behavior:** Preselect first-time recipients only; leave failed requests unchecked until the operator deliberately selects them for retry.
- **Why:** Make first sends and retries clear and prevent a retry from being included by default.
- **Material alternative rejected:** Automatically select every eligible failed request.
- **Approval source/date:** Current task request, 2026-10-12.
- **Affected workflow/contract:** Availability form SMS in Forms.

## Implementation references

- Entry point: `client/src/pages/Teams/managers/IntakeManager.tsx`
- Implementation: `client/src/pages/Teams/components/AvailabilityFormWorkspace.tsx`, `client/src/pages/Teams/components/AvailabilityVolunteersList.tsx`, `client/src/pages/Teams/components/AvailabilityDateComparison.tsx`, `client/src/pages/Teams/components/AvailabilityFormSendFlow.tsx`, `client/src/pages/Teams/components/AvailabilityBatchReview.tsx`, `client/src/pages/Teams/availabilityFormProgress.ts`, `client/src/pages/Teams/availabilityRecipientSelection.ts`, `client/src/pages/Teams/availabilityNotificationHistory.ts`, `client/src/pages/Teams/pages/TeamsMessagesPage.tsx`, `server/notificationIntents.js`, `server/teamsAuthHandlers.js`
- Tests: `client/src/pages/Teams/pages/TeamsFormsPage.workspace.test.tsx`, `client/src/pages/Teams/managers/IntakeManager.test.tsx`, `client/src/pages/Teams/availabilityFormProgress.test.ts`, `client/src/pages/Teams/components/AvailabilityFormSendFlow.test.tsx`, `client/src/pages/Teams/components/AvailabilityBatchReview.test.tsx`, `client/src/pages/Teams/availabilityRecipientSelection.test.ts`, `client/src/pages/Teams/availabilityNotificationHistory.test.ts`, `client/src/pages/Teams/pages/TeamsMessagesPage.test.tsx`, `server/notificationIntents.test.js`, `server/teamsApi.test.js`

## Technical design notes (separate from product requirements)

Forms and Messages load every page of notification intents plus the form's SMS delivery attempts before allowing selection. Recipient eligibility is shared through `getAvailabilityRecipientRows`; batch preparation and dispatch continue through the existing notification intent API.

The [SMS foundation audit and architecture](../sms-foundation-architecture.md) records the shared batch boundary, state/approval/idempotency rules, current recovery and authorization gaps, hosting options, and the unimplemented schedule SMS integration contract. `server/notificationBatches.js` now provides feature-independent review identity, approval transition, dispatch selection and result aggregation; availability adapters keep form/recipient validation and API formatting. Send claims checkpoint their delivery attempt ID before provider work. Batch recovery checks church, batch and feature ownership before mutating stale intents.

The operator flow now presents review content in the existing confirmation modal: preparing a batch opens that modal, and only its final Send action dispatches messages. This changes the placement and number of UI actions; it does not change batch identity, approval checks, or dispatch behavior.

Dispatch remains synchronous and request-bound in this phase. The extraction does not establish reliable background execution, multi-number inbound mapping or complete team-scoped messaging authorization. Existing manual-send and duplicate-send decisions above remain authoritative; the product owner selected existing-web-dyno continuation and one message per volunteer per schedule for future work on 2026-10-12. Those decisions and the intended week-before reminders are recorded in the architecture document; reminder sending remains explicitly reviewed and operator-approved. No new execution behavior is implemented in this phase.

## Delivery reliability decision (Phase 2, 2026-10-12)

The current Phase 2 request authorizes shared monotonic reconciliation of send results, recovery and authenticated callbacks. Confirmed provider evidence is retained after persistence failure and used to repair the intent; accepted and uncertain sends stay blocked. Recovery rechecks current claim ownership transactionally. New sends bind signed callbacks to an opaque persisted attempt token, allowing acceptance evidence before SID persistence; old data requires no migration and unattributable outcomes remain blocked. An older accepted attempt permanently fences further claims without replacing a newer attempt's identity. Existing selection, review, confirmation, deliberate definitive-failure retries, consent, message text, private links and permissions are unchanged. See [the authoritative delivery lifecycle](../sms-foundation-architecture.md#phase-2-delivery-reliability-contract-authoritative).
