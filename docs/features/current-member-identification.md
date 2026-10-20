# Feature Contract: Current member identification

**Contract status:** Confirmed product intent

**Approval source:** Current request dated 2026-10-19

**Last reviewed:** 2026-10-19

## Purpose

Help signed-in users recognize their own linked roster member across Teams and Services.

## Expected behavior

- The authenticated Teams bootstrap may include `selfMemberId`, resolved from the human session UID, active church, and canonical roster.
- Return an ID only when exactly one active same-church roster record links to that UID and its member ID agrees with its canonical document ID. Return `null` for unlinked accounts, non-human sessions, duplicate or inconsistent links, and truncated roster data.
- Preserve restricted member projections: never expose roster `userId` values to display a self indicator.
- Render a compact muted cyan **You** label only when a displayed roster `memberId` exactly matches the authoritative `selfMemberId`.
- In the Members roster, include **You** in the edit button's accessible name only for that exact linked member.
- Keep names as display strings. Do not infer identity from names or contact details, and do not mark unmatched intake submissions or schedule guests.
- Refresh identity with bootstrap reconciliation and clear it across church, account, and session changes.

## Behavioral boundaries

- Account linking and unlinking permissions and mutations remain unchanged. A new bootstrap result updates the indicator after those mutations.
- Assignment, eligibility, sorting, search, availability, notification content, schedule export, credits, and public output remain unchanged.
- Workstation and other non-human sessions receive no self roster ID.

## Important scenarios

| Scenario | Expected behavior | Implementation / test evidence |
| --- | --- | --- |
| One valid active link | Return and display that member ID | `server/teamsBootstrapProjection.test.js`; `CurrentUserMemberIndicator.test.tsx` |
| Unlinked, duplicate, inconsistent, or truncated roster | Return no self ID | `server/teamsBootstrapProjection.test.js` |
| Restricted team viewer | See their own ID marker without receiving any roster `userId` | `server/teamsApi.test.js` |
| Church or account changes while a bootstrap is pending | Clear the old marker immediately and ignore stale identity | `useTeamsPageState.test.tsx` |
| Guest assignment or unmatched submission | Keep the display name unmarked | `ScheduleBoardCell.test.tsx`, `ScheduleGridCell.test.tsx`, `IntakeManager.test.tsx` |

## Product decision

- **Question/problem:** A signed-in user cannot easily identify their linked roster entry throughout Teams and Services.
- **Approved behavior:** Resolve the user's active roster member on the server and show a subtle **You** marker beside that exact member ID across authenticated roster surfaces.
- **Accessibility:** The Members roster edit control includes **You** in its accessible name for that exact member; generic entity edit labels remain unchanged.
- **Why:** Users need a consistent cue while managing members, schedules, forms, messages, and service assignments.
- **Material alternative rejected:** Matching display names or exposing roster account-link identifiers to clients.
- **Approval source/date:** Current user request dated 2026-10-19.

## Implementation references

- Server identity and projection: `server/teamsBootstrapProjection.js`, `server/teamsAuthHandlers.js`
- Teams state and provider: `client/src/pages/Teams/hooks/useTeamsPageState.ts`, `client/src/pages/Teams/TeamsPageContext.tsx`
- Shared indicator: `client/src/pages/Teams/components/CurrentUserMemberIndicator.tsx`
- Current Service consumers: `client/src/pages/Controller/CurrentServiceWorkspace.tsx`, `client/src/pages/Services/ServicePlanAssigneeList.tsx`
