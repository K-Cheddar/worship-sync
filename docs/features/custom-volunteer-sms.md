# Feature Contract: Custom volunteer text messages

**Contract status:** Confirmed product intent from the Messages redesign request, 2026-10-22.

## Purpose and workflow

Messages opens to searchable outbound SMS history. An authorized administrator chooses **New message**, explicitly selects volunteers or Teams, writes ordinary text, reviews the exact body and recipients, then chooses **Send X messages**. Forms owns availability requests and Schedules owns schedule notifications. Both continue using the existing notification foundation, and their authorized history appears in Messages.

Each deliberate custom send is a separate batch with separate member intents. Replaying that batch cannot repeat a provider call for a recipient already accepted or uncertain. Consent, STOP, active roster, current phone, church isolation and current Team permission are checked during review and again before sending. A shared phone does not collapse separate roster identities. Provider acceptance is displayed separately from confirmed delivery.

## Activation boundary

Recorded administrator consent currently says the volunteer agreed to texts about availability, scheduling, assignments and related reminders. The repository does not establish that the registered Twilio campaign covers arbitrary custom volunteer text. The server's `CUSTOM_VOLUNTEER_SMS_READY` constant is hard-disabled. The server refuses custom dispatch while false, including direct intent sends. Preparation and review may be used to inspect the workflow, but no custom provider request may occur.

Before changing the constant in a reviewed release, a responsible operator must verify the active Twilio campaign's approved use case and each applicable consent disclosure cover the intended **operational volunteer communications**, and determine whether existing consent records are valid for that scope. Marketing, fundraising and promotional texts are outside this feature and must not be authorized by this gate. If the existing disclosure is too narrow, obtain appropriately scoped consent before activation; do not reinterpret old records. Also complete real Firestore contention, browser and provider pacing verification before activation. Record the campaign and consent decision in operational documentation. No production activation or deployment is part of this implementation.

## Current implementation limits

History is built from notification intents and provider attempts and preserves older records. Older outbound SMS that never created a notification intent are outside this list. The interface does not receive or display replies; STOP/START remains handled by the existing webhook. Custom batch dispatch uses the current reviewed batch executor and does not add a separate delivery ledger.
