# Feature Contract: Availability form SMS

**Contract status:** Confirmed product intent

**Approval source:** Current task request dated 2026-10-12; duplicate-send decision confirmed by the product owner in this conversation on 2026-10-12.

**Last reviewed:** 2026-10-12

## Purpose

Let an authorized church administrator or team editor prepare and send a monthly availability form request by SMS, with each volunteer receiving their own secure response link.

## Operator workflow

From the selected active availability form, the operator opens **Send form**, reviews automatically selected eligible members and the reasons others cannot be selected, optionally changes recipients with team and name filters, prepares and reviews each personalized SMS, then explicitly confirms the send. Results remain visible in the form workflow.

## Expected behavior

- Eligible, active members in the form's selected team scope with no prior request are selected automatically. A definitively failed request remains eligible but starts unselected; the operator must choose it to retry.
- Members without SMS consent or a valid phone, opted-out numbers, archived members, out-of-scope members, previously responded members, and members whose request was already sent are not selectable.
- The operator can add or remove eligible members. Filtering and searching do not change selection. An explicit deselection stays in effect when consent or other eligibility data refreshes.
- Recipient selection and batch preparation do not send SMS. Sending requires the existing explicit confirmation for the reviewed batch.
- Each message uses the existing private response link for that member and form. Existing response records and links remain valid; volunteers do not need WorshipSync accounts.
- If multiple selected members share a phone number, review shows the shared destination while retaining separate messages and private response links for each member.
- Provider-accepted requests remain blocked from resend, including attempts later reported undelivered. A definitively rejected delivery can be selected again after the operator reviews its history. An uncertain or in-progress outcome stays blocked and is never retried automatically.
- Opening Send form refreshes the complete current-form message and delivery history. Recipient selection and review stay disabled until that refresh succeeds; stale responses cannot replace a newer snapshot.
- Consent and phone eligibility are checked again by the server at send time. Existing form scope, recipient identity, response, consent, durable claim, approval-version, idempotency, and STOP protections remain authoritative.
- Creating or editing a form, recording consent, opening the workflow, and preparing a batch do not send SMS. Automatic sends remain disabled.
- Forms is the primary location for sending a form request. Messages may continue to provide advanced message management and history.

## Behavioral boundaries

- This workflow does not add bulk consent recording, automatic reminders, scheduled jobs, or a new notification system.
- A team-scoped editor must not be able to send to unrelated teams through this workflow. Existing authorization behavior is preserved.
- Selection is constrained to the form's selected teams; an empty team list retains the server's existing all-team form semantics.
- The duplicate-send decision applies to a confirmed, provider-accepted request. There is no manual resend override for it.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| Normal workflow | Eligible unsent members in form scope are preselected; review is separate from explicit send confirmation. | `AvailabilityFormSendFlow.test.tsx`; `notificationIntents.test.js` | Confirmed by current request; implemented |
| Repeated or explicit action | Provider-accepted requests stay excluded, including later undelivered attempts; uncertain sends cannot be retried automatically. | Duplicate-send regression in `notificationIntents.test.js`; `availabilityRecipientSelection.test.ts`; intent claim and dispatch guards in `server/notificationIntents.js` | Duplicate-send decision confirmed on 2026-10-12; implemented |
| Failed send retry | Definitive failures are available for deliberate selection and do not join first-time recipients in the automatic selection. | `AvailabilityFormSendFlow.test.tsx`; `availabilityRecipientSelection.test.ts` | Confirmed by current request dated 2026-10-12; implemented |
| Manual change | Eligible recipients can be unchecked or added; filters preserve selection and explicit unchecks survive eligibility refresh. | `AvailabilityFormSendFlow.test.tsx`; `TeamsMessagesPage.test.tsx` | Confirmed by current request; implemented |
| Missing, incomplete, or unavailable data | Consent and full form message history must load before recipients can be selected or reviewed. | `availabilityNotificationHistory.test.ts`; Forms and Messages flow tests | Confirmed by current request; implemented |
| Error or recovery | Definitive failures are visible and may be prepared again; unknown outcomes require history review and are not automatically retried. | `notificationIntents.test.js`; `AvailabilityBatchReview.test.tsx` | Confirmed by current request; implemented |
| Shared phone number | Review identifies the common destination and still shows each member's separate private message. | `AvailabilityBatchReview.test.tsx`; server recipient and response-link tests in `teamsApi.test.js` | Confirmed by current request; implemented |

## Product decisions

- **Question/problem:** Should a form request whose SMS was already confirmed sent be selectable for another manual send?
- **Approved behavior:** Keep the existing duplicate-send block; show the member as already sent and prevent reselection.
- **Why:** Preserve the existing server-side duplicate-send protection as explicitly requested.
- **Material alternative rejected:** Add a deliberate manual resend path.
- **Approval source/date:** Product-owner reply to the clarification question in this conversation, 2026-10-12.
- **Affected workflow/contract:** Availability form SMS, in Forms and the shared Messages recipient selector.

- **Question/problem:** Should definitively failed form requests be included in the default recipient selection?
- **Approved behavior:** Preselect first-time recipients only; leave failed requests unchecked until the operator deliberately selects them for retry.
- **Why:** Make first sends and retries clear and prevent a retry from being included by default.
- **Material alternative rejected:** Automatically select every eligible failed request.
- **Approval source/date:** Current task request, 2026-10-12.
- **Affected workflow/contract:** Availability form SMS in Forms.

## Implementation references

- Entry point: `client/src/pages/Teams/managers/IntakeManager.tsx`
- Implementation: `client/src/pages/Teams/components/AvailabilityFormSendFlow.tsx`, `client/src/pages/Teams/components/AvailabilityBatchReview.tsx`, `client/src/pages/Teams/availabilityRecipientSelection.ts`, `client/src/pages/Teams/availabilityNotificationHistory.ts`, `client/src/pages/Teams/pages/TeamsMessagesPage.tsx`, `server/notificationIntents.js`, `server/teamsAuthHandlers.js`
- Tests: `client/src/pages/Teams/components/AvailabilityFormSendFlow.test.tsx`, `client/src/pages/Teams/components/AvailabilityBatchReview.test.tsx`, `client/src/pages/Teams/availabilityRecipientSelection.test.ts`, `client/src/pages/Teams/availabilityNotificationHistory.test.ts`, `client/src/pages/Teams/pages/TeamsMessagesPage.test.tsx`, `server/notificationIntents.test.js`, `server/teamsApi.test.js`

## Technical design notes (separate from product requirements)

Forms and Messages load every page of notification intents plus the form's SMS delivery attempts before allowing selection. Recipient eligibility is shared through `getAvailabilityRecipientRows`; batch preparation and dispatch continue through the existing notification intent API.

The [SMS foundation audit and architecture](../sms-foundation-architecture.md) records the shared batch boundary, state/approval/idempotency rules, current recovery and authorization gaps, hosting options, and the unimplemented schedule SMS integration contract. `server/notificationBatches.js` now provides feature-independent review identity, approval transition, dispatch selection and result aggregation; availability adapters keep form/recipient validation and API formatting. Send claims checkpoint their delivery attempt ID before provider work. Batch recovery checks church, batch and feature ownership before mutating stale intents.

Dispatch remains synchronous and request-bound in this phase. The extraction does not establish reliable background execution, multi-number inbound mapping or complete team-scoped messaging authorization. Existing manual-send and duplicate-send decisions above remain authoritative; the product owner selected existing-web-dyno continuation and one message per volunteer per schedule for future work on 2026-10-12. Those decisions and the intended week-before reminders are recorded in the architecture document; reminder sending remains explicitly reviewed and operator-approved. No new execution behavior is implemented in this phase.
