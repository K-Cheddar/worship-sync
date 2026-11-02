# Feature Contract: Custom volunteer text messages

**Contract status:** Confirmed product intent from the current request, 2026-10-22.

## Purpose and workflow

Messages opens to searchable outbound SMS history. An authorized administrator chooses **New message**, selects volunteers or Teams, and writes a coordination message. For one eligible recipient, the composer shows the exact final text, recipient name and masked destination; **Send message** prepares a fresh approval and dispatches it in one action when those details still match. A material change stops the send and asks the administrator to confirm the updated details.

For multiple recipients, **Send to X volunteers** prepares the server review and opens one compact confirmation with the exact text, eligible and excluded counts, SMS segment estimate, warnings and an optional recipient list. **Cancel** returns to the editable composer; **Send X messages** dispatches the confirmed review. There is no separate saved-review workflow.

Examples include practice reminders, meeting updates, schedule changes, volunteer instructions and service preparation announcements. Marketing, fundraising and promotional messages are outside this feature.

Forms owns availability requests and Schedules owns schedule notifications. Those workflows continue using the notification foundation, and their authorized history appears in Messages.

Each deliberate custom send is a separate batch with separate member intents. Replaying that batch cannot repeat a provider call for a recipient already accepted or uncertain. Consent, STOP, active roster, current phone, church isolation and current Team permission are checked during review and again before sending. A shared phone does not collapse separate roster identities. Provider acceptance is displayed separately from confirmed delivery.

## Drafts, approvals and delivery recovery

An editable draft stores only message text and selected member IDs in browser storage scoped by church and signed-in administrator. It is restored for convenience and never authorizes sending. Preparing a message creates a separate server approval snapshot with current eligibility, destination, authorization and expiry information. Every new send attempt prepares a fresh batch; an expired approval is never reused. If a just-confirmed approval expires before dispatch, a fresh approval can be dispatched automatically only when its message, recipients, displayed destinations, eligibility and segment estimate still match what was confirmed. Changed details require another explicit confirmation.

Prepared reviews that were never dispatched do not appear as requiring attention when Messages opens. Their approval expires without removing the editable draft. Once dispatch may have started, the persisted batch and provider attempts remain authoritative; history shows the operation and offers **Check delivery status** for an unconfirmed outcome. WorshipSync never automatically resends an operation with an uncertain result. Definitive failures remain in history, and a deliberate new send prepares a separate operation.

The Messages route is lazy-loaded inside the authenticated Teams workspace. Draft ownership follows the current church and human administrator identity; server authorization remains the authority for each preparation and dispatch.

## Product decisions

- The current request (2026-10-22) confirms **Compose → Send** for one eligible recipient and **Compose → Send → Confirm recipients** for multiple recipients. It also confirms that drafts remain editable independently of server approval expiration and that unresolved delivery stays recoverable through history.

## SMS configuration, consent and campaign scope

Custom messages use the church's existing SMS configuration. Sending requires the church SMS configuration to be enabled and approved, an authorized administrator, a valid current phone number, applicable recorded consent, no opt-out, and normal message validation. The single-recipient **Send message** action is the administrator's explicit approval; bulk messages require confirmation of the reviewed recipients. The application has no separate custom-message activation flag. Preparation does not send.

The current consent disclosure says:

> I agree to receive SMS messages from my church through WorshipSync about volunteer availability, scheduling, assignments, and related reminders. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is optional and is not required to use WorshipSync.

Removing the application flag does not broaden this consent or rewrite existing consent records. Use a volunteer's recorded consent only for content covered by that consent. Obtain appropriately scoped consent before sending content that goes beyond it; do not reinterpret existing records. Marketing, fundraising and promotional messages remain outside this feature.

The repository does not contain the registered Twilio campaign's use case or description, so its coverage of the examples above has not been verified here. Existing church configuration records provider readiness and registration status, not campaign scope. A responsible operator must verify the active campaign's approved use case before using custom messages in production. Removing the application flag does not change Twilio's approved use case.

## Operational safeguards and limits

- Review shows the exact final message, eligible and excluded recipients, masked destinations and SMS segment estimates. Exclusions identify issues such as missing consent, opt-out or an invalid phone number.
- The server rechecks authorization, church SMS configuration, roster status, phone number, consent, opt-out and message review immediately before each provider request.
- The single-recipient **Send message** action or final bulk confirmation is the administrator's explicit approval. Existing batch and notification identities, delivery attempts, idempotency, concurrent-dispatch protection, callbacks, delivery history, unknown-outcome handling and provider error handling remain in effect. The 500-recipient preparation limit and 1,500-character message limit are unchanged.
- STOP and START continue through the existing inbound webhook. Messages does not receive or display replies.
- History is built from notification intents and provider attempts and preserves older records. Older outbound SMS that never created a notification intent are outside this list. Custom batch dispatch uses the current reviewed batch executor and does not add a separate delivery ledger.
- Real Firestore contention, browser and provider pacing checks remain operational verification items. This implementation does not deploy or send real SMS messages.
