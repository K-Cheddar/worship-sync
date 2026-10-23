# Feature Contract: Team roster editing in Create/Edit Team

**Contract status:** Mixed; inline membership editing is confirmed, broader team roster and access workflows remain under review

**Approval source:** Current request dated 2026-10-18

**Last reviewed:** 2026-10-19

## Purpose

Let authorized team editors quickly see who is on a team and make membership changes without leaving the Create/Edit Team form.

## Operator workflow

An editor opens a team, reviews the assigned members in alphabetical order, and searches inline for an active person to add. Removing a member requires confirmation. Church-wide administrators save or cancel membership changes with the rest of the team draft. Team-scoped managers save each roster change immediately through the restricted roster endpoints.

## Expected behavior

- Show assigned members first, sorted by display name using `memberName` and a locale-aware comparison. Show eight at first for larger teams, with an inline control to show the full list. Always render assigned membership, even when a member projection is unavailable.
- Do not show the available directory until the editor searches. Show matching unassigned members in alphabetical order, with one Add action per member. Exclude archived people from global-admin suggestions.
- Scoped search sorts all eligible matches before returning at most 20 candidates and reports when more matches exist, so the editor can prompt users to refine a broad search.
- Church-wide administrators change `memberIds` in the existing draft. Save uses the existing `memberIds` and `baseMemberIds` contract when membership changed; an unrelated settings save omits membership fields. Cancel discards draft changes.
- Team-scoped managers search only through `searchTeamRosterCandidates`, then add or remove through the scoped roster endpoints. These endpoints retain their existing authorization checks, safe member projections, membership synchronization, and projection reconciliation.
- Confirm before removing a member. Scoped removal explains that team positions, role, and qualifications are removed, while historical schedule assignments remain. Removing someone from a team never deletes their member record.
- Team member profile editing and the existing Create new member flow remain available to scoped editors.

## Behavioral boundaries

- The inline editor does not add a permission or expose the full roster, cross-team information, or sensitive member fields to scoped managers.
- The church-wide draft path and the scoped immediate-persistence path remain separate.
- Schedule assignments and unrelated team settings are not changed by a roster-only edit.
- `EntityMultiSelect` remains unchanged for other forms.
- Broader team roles, positions, qualifications, archive, delete, and access workflows are not newly confirmed by this contract.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| Normal workflow | Current members appear first; suggestions appear only after search. | `TeamMembersEditor.tsx`; `TeamMembersEditor.test.tsx`; `TeamManager.permissions.test.tsx` | Confirmed by current request |
| Global administrator edits | Add/remove changes remain in the draft until Save; Cancel discards them. | `TeamManager.tsx`; `TeamManager.permissions.test.tsx` | Confirmed by current request |
| Scoped manager edits | Candidate search and immediate roster mutations use restricted server endpoints. | `TeamManager.tsx`; `server/teamsAuthHandlers.js`; `TeamManager.permissions.test.tsx`; `server/teamsApi.test.js` | Confirmed by current request; permission boundary retained |
| Removal | Scoped removal clears team-specific positions, role, and qualifications after confirmation; historical assignments and the member record remain. | `mutateTeamRoster` in `server/teamsAuthHandlers.js`; `TeamManager.permissions.test.tsx`; `server/teamsApi.test.js` | Confirmed by current request |
| Concurrent roster update | Unchanged membership is omitted from settings saves; changed membership is applied as a baseline-aware delta. | `TeamManager.navigation.test.tsx`; `updateTeamWithMemberIdsDelta` in `server/teamsAuthHandlers.js` | Confirmed preservation boundary |
| Search failure or team switch | Show a retry path and ignore results from an older query or team. | `TeamManager.permissions.test.tsx` | Confirmed by current request |

## Product decisions

- **Question/problem:** The member picker in Create/Edit Team is difficult to scan and uses substantial space.
- **Approved behavior:** Replace it with an inline alphabetical assigned-members list and an inline search for additions. Keep the global-admin draft path and the scoped immediate API path separate.
- **Why:** Editors should be able to identify and change membership quickly while existing authorization, save, concurrency, and removal protections remain intact.
- **Material alternative rejected:** A separate membership modal, drawer, or page; combining the two persistence paths.
- **Approval source/date:** Current user request dated 2026-10-18.
- **Affected workflow/contract:** Create/Edit Team membership; broader team roster behavior remains inventory-only.

## Implementation references

- Entry point: `client/src/pages/Teams/pages/TeamsGroupsPage.tsx`
- Implementation: `client/src/pages/Teams/managers/TeamManager.tsx`, `client/src/pages/Teams/components/TeamMembersEditor.tsx`, `client/src/api/auth.ts`, `server/teamsAuthHandlers.js`
- Tests: `client/src/pages/Teams/components/TeamMembersEditor.test.tsx`, `client/src/pages/Teams/managers/TeamManager.permissions.test.tsx`, `client/src/pages/Teams/managers/TeamManager.navigation.test.tsx`, `server/teamsApi.test.js`

## Technical design notes

- Global edits update the team draft and use `updateTeam` with the captured baseline only when membership changed. The server applies the membership delta to its current roster so concurrent additions are retained.
- Scoped search returns safe display projections for active candidates and indicates when its sorted 20-result page is truncated. Scoped membership mutations synchronize team/member projection state, remove team-owned positions and qualifications where appropriate, and retain historical schedule assignments.
- Suggestions and assigned rows use `memberId` for identity. Names are display values only.
