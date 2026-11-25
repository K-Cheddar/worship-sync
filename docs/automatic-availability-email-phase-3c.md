# Phase 3C: Automatic availability email

**Implementation status:** Code path and mocked-provider integration are implemented. Production delivery remains disabled. The Firestore emulator integration and controlled demo still need to run before calling the vertical workflow verified.

## Safety controls

Automatic processing has four independent church settings:

1. **Church-wide availability automation** is the master switch.
2. **Automatic availability form creation** controls creating a form and personal recipients.
3. **Automatic availability email** controls initial email delivery and requires an explicit administrator confirmation.
4. **Automatic availability SMS** remains disabled.

Existing churches, new timing settings, and both delivery gates default off. Settings writes use a revision check and an audit event. Team overrides can disable a team but cannot bypass the master switch.

The server must also have:

```text
SCHEDULING_AUTOMATION_EMAIL_ENABLED=true
RESEND_API_KEY=<server secret>
RESEND_FROM_EMAIL=<verified sender>
```

`--live` fails closed if the server gate or Resend configuration is missing. Each dispatch then rechecks the church master, church email switch, team override, cycle activation, active form/deadline, active recipient and current email preference/address. Disable **Automatic availability email** to stop new sends; disable the master to stop both form and delivery processing. Turning off the environment gate prevents live execution on the next invocation. An in-flight provider request may still finish; its result is recorded or held as uncertain.

## Durable lifecycle

The cycle has a form-creation action (`availability_request`) and a separate email action (`availability_email_delivery`). The first creates or reuses one scoped form and its personal recipients. The second creates deterministic records in `notificationIntents`, claims them transactionally, sends through the existing Resend wrapper and records the acceptance ID. The timeline says “accepted by provider”; it never claims inbox delivery.

Email intent identity is a stable hash of church, cycle, form, recipient, request type and channel. A stable Resend idempotency key fences safe retry. Resend retains keys for 24 hours and requires retries to use the same request payload ([provider documentation](https://resend.com/changelog/idempotency-keys)); the implementation stops retrying before that window closes. A definite 429 may retry at most three times. Other definitive provider rejections are recorded as failed. Timeout, missing acceptance evidence, or a process interruption after the `sending` claim becomes uncertain/review-required and is not retried automatically. The intent stores a destination hash and provider receipt, never the personalized URL or full contact address.

If an existing Phase 3A/3B cycle has a completed form action but no email action, cycle rediscovery adds the deterministic delivery action and links the completed form. It does not rerun form creation. A completed delivery remains terminal when the cycle is rediscovered.

`--execute` may create cycles, forms and recipients. It does not create email intents or call a provider; a newly created email action stays disabled. `--live` can process the form action and, if the bounded action/time budget remains, its separate email action during the same run. Repeated invocations reuse the same forms, credentials, intents and provider idempotency identity.

## Occurrence and recipient safety

Occurrence equivalence is canonicalized by date and service identity with the existing conservative occurrence resolver. Exact grouped/standalone aliases are equivalent only for that date. The code does not use current group membership to rewrite historical issued-form meaning; ambiguous evidence is held for review.

Manual and automatic form creation share a church/team Firestore guard and inspect active same-team form overlaps transactionally. An exact form may be reused; ambiguous or competing overlap is held for review. Existing manual forms, occurrence IDs and submitted answers are not rewritten.

Automatic, manual, personalized-link, signed-in and response paths use the same availability scope rule: current tenant, non-archived member/team/position and a valid direct team membership, active member-side membership or active position assignment. Recipient links are checked against current membership when read or submitted, so a stale recipient record alone does not preserve access. A person without email or with email notifications off remains eligible for the request and personal form access.

Roster discovery targets the selected team's members, member-side membership, and active position assignments. Transactional recipient/link issuance re-reads the current member, teams and referenced positions; it does not scan the full church roster.

## Processor commands

Run from the repository root and keep every run scoped to a demo church/team while validating:

```powershell
npm run process:scheduling-automation -- --dry-run --church=DEMO_CHURCH_ID --team=DEMO_TEAM_ID --period=2027-01
npm run process:scheduling-automation -- --execute --church=DEMO_CHURCH_ID --team=DEMO_TEAM_ID --period=2027-01 --limit=10
npm run process:scheduling-automation -- --live --church=DEMO_CHURCH_ID --team=DEMO_TEAM_ID --period=2027-01 --limit=10
```

The first command is read-only. For an eligible request action it includes `availabilityPreview` with the form ID and create/reuse decision, in-scope recipient estimate, email-eligible count, missing-email count, and preference/account exclusions. The preview does not create cycles, forms, recipients, tokens, intents, claims, or provider calls. The second command creates/reuses forms and recipients without preparing email intents. The third can send only when the environment gate, Resend, church master and church email control are all enabled. Do not point `--live` at production volunteers. This milestone adds no Heroku Scheduler job or long-running worker.

## Emulator and controlled-provider verification

The integration test calls the real `runSchedulingAutomationProcessor` composition from `authService.js`, which uses the actual availability form/recipient and email-intent operations with Firestore emulator persistence. Only the external email provider is replaced by a fake that returns stable acceptance IDs. It verifies a position-assigned recipient, a no-email recipient, response deadline and occurrence scope, accepted provider receipt, separate completed actions, and a repeated invocation without duplicate forms, intents or provider calls.

Run it with:

```powershell
npx --yes firebase-tools@14.4.0 emulators:exec --only firestore --project demo-worshipsync "node --import tsx --test --test-reporter=spec server/schedulingAvailabilityEmailIntegration.firestore.test.js"
```

The regular server test runner also discovers the test, and GitHub Actions runs the server suite inside a Firestore emulator. This machine has no Java executable and no `FIRESTORE_EMULATOR_HOST`, so the local focused test was skipped. No local emulator-backed end-to-end result is claimed. No real email, production Firestore write, SMS, deployment, or index rollout was performed.

## Firestore indexes

The form-creation guard uses an indexed active availability overlap query on `teamIntakeForms`: `churchId`, `purpose`, `active`, `teamIds` array membership and `endDate`. The email action queries recipients and intents by `(churchId, formId)`, using the existing composite indexes. Processor due-action queries use the existing scheduling-action indexes. Definitions are checked in `firestore.indexes.json`; deploy and wait for any index only in an authorized deployment window with `npm run firebase:update-indexes`.

## Not included

Automatic SMS, nonresponder reminders, leader summaries, Auto-fill, schedule draft generation, publication, production activation, a worker, and Heroku Scheduler remain out of scope. Manual SMS, consent and A2P handling are unchanged.
