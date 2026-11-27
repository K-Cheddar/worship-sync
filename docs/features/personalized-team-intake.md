# Feature Contract: Personalized team intake profile completion

**Contract status:** Confirmed product intent

**Approval source:** Current user request dated 2026-10-23

**Last reviewed:** 2026-11-24

## Purpose

Let a volunteer complete supported personal details that are missing from their linked roster member while responding through the existing personalized intake form.

## Operator workflow

A volunteer opens their recipient-bound link and sees the existing form. Enabled personal-information inputs appear only for fields that are empty or missing on their roster member. The volunteer submits the form once; the response and newly supplied details are saved to that linked member.

## Expected behavior

- The personalized preview returns an allowlisted list of missing supported fields, not the member's existing profile values. Its existing first-name greeting remains.
- The public form displays an existing personal-information input only when the form enables it and the preview says the linked member is missing it. It renders no personal-information section when no enabled personal field is missing.
- Submission accepts only enabled fields that remain missing on the current member. It uses existing normalization and validation, ignores blank values, and does not replace populated fields.
- The same behavior applies to recipient-bound `general_intake` and `team_availability` links. Existing availability forms remain availability-only under their current form rules; empty personal inputs do not block those responses.
- Dedicated availability personalized links continue to identify the volunteer from the validated recipient credential and do not ask for identity fields again. Their shared saved welcome message is the same wording shown on the form's general link.
- Dedicated availability general links collect required first and last names and an optional normalized email independently of `enabledFields`. They are separate, unverified submissions: matching suggestions are restricted to the form's Team scope, and only an administrator's explicit selection can apply one to an existing member.
- Dedicated availability responses merge only submitted service-date answers into member availability. Missing dates in older partial records are not reinterpreted as unavailable.
- Firestore transaction and fallback writes update the linked roster member. Adding an email keeps its contact index current.
- Non-personalized forms retain their existing field visibility and submission behavior.

## Behavioral boundaries

- Recipient token identity, membership scope, authorization, and form response behavior remain authoritative.
- This change does not add a profile editor, endpoint, phone-number collection, or SMS consent behavior.
- Availability form messaging, identity collection for general links, and manual general-response review follow the dedicated availability contract in [Availability form text messages](team-availability-sms.md). This does not add identity questions to personalized availability links or change their recipient-bound application.
- Public roster data, general-link authorization, positions, scheduling preferences, blockout dates, notes, and unrelated general-intake behavior remain unchanged.
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
