# Member text message eligibility and consent

**Contract status:** Confirmed product intent

**Approval source:** Current task request dated 2026-10-16.

## Purpose

Show an authorized church administrator the current text message eligibility for a roster member and let them record consent the member has already given.

## Operator workflow

From Teams → Members, an administrator edits a member's mobile number and saves. When the saved number changes, Teams checks the server's current eligibility. A member with a valid number and no consent can be offered **Record text message consent**. The administrator records verbal or signed-form consent in the existing modal.

## Expected behavior

- Eligibility comes from the server's church-scoped consent records and the member's persisted phone number.
- A valid number without consent is **Consent needed**; confirmed consent is **Enabled**; an opted-out number is **Opted out**; a missing or invalid number is **No valid mobile number**.
- Consent belongs to the church and normalized phone number. Changing a member's number does not transfer the prior number's consent, clear an opt-out, or record consent.
- After a successful save changes the mobile number, the status and available actions update without navigating away or restarting WorshipSync.
- While the server checks the saved number, the editor says **Checking text message status…** and does not present the previous number's eligibility as current. If the check fails, it explains the problem and offers **Try again**.
- **Record text message consent** remains available only to authorized church administrators when the current server eligibility is `consent_needed` and the saved number is valid. The server repeats the authorization and eligibility checks when consent is recorded.
- Removing a mobile number refreshes the status to **No valid mobile number**. Changes to unrelated member details do not trigger an eligibility refresh.

## Behavioral boundaries

- Editing a number never opts a member in or overrides STOP.
- Team-scoped managers and read-only users cannot record consent.
- Existing SMS delivery, retry, and Twilio behavior is unchanged.
- A refresh result for an earlier phone, another member, or another church must not replace newer state.

## Implementation references

- Entry point: `client/src/pages/Teams/pages/TeamsMembersPage.tsx`
- State refresh: `client/src/pages/Teams/hooks/useTeamsPageState.ts`
- Eligibility display and consent action: `client/src/pages/Teams/managers/MemberManager.tsx`
- Server authority: `server/smsEligibility.js`, `server/teamsAuthHandlers.js`, `authService.js`
- Tests: `client/src/pages/Teams/pages/TeamsMembersPage.test.tsx`, `client/src/pages/Teams/hooks/useTeamsPageState.test.tsx`, `client/src/pages/Teams/managers/MemberManager.test.tsx`, `server/smsMessaging.test.js`, `server/teamsApi.test.js`
