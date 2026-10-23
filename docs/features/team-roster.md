# Feature Contract: Team roster editing and member management

**Contract status:** Confirmed for inline membership editing and team-scoped member management

**Approval source:** Current request dated 2026-10-23

**Last reviewed:** 2026-10-23

## Purpose

Let authorized team editors quickly see who is on a team and change membership in the Create/Edit Team form. Use Members as the single destination for editing a person's profile, with the originating team retained as context.

## Operator workflow

An editor opens a team, reviews the assigned members in alphabetical order, and searches inline for an active person to add. Removing a member requires confirmation. Church-wide administrators save or cancel membership changes with the rest of the team draft. Team-scoped managers save each roster change immediately through the restricted roster endpoints. Manage opens that member in Members with the team selected and a return path to the edited team. Global editors use the full member form; scoped managers receive only the selected team's positions, role, and qualifications, loaded and saved through the restricted team-profile endpoints.

## Expected behavior

- Show assigned members first, sorted by display name using `memberName` and a locale-aware comparison. Show eight at first for larger teams, with an inline control to show the full list. Always render assigned membership, even when a member projection is unavailable.
- Keep member rows focused on names; place removal in each row's Actions menu with a trash icon. Confirm before removing a member.
- Do not show the available directory until the editor searches. Show matching unassigned members in alphabetical order, with one Add action per member. Exclude archived people from global-admin suggestions.
- Scoped search sorts all eligible matches before returning at most 20 candidates and reports when more matches exist, so the editor can prompt users to refine a broad search.
- Church-wide administrators change `memberIds` in the existing draft. Save uses the existing `memberIds` and `baseMemberIds` contract when membership changed; an unrelated settings save omits membership fields. Cancel discards draft changes.
- Team-scoped managers search only through `searchTeamRosterCandidates`, then add or remove through the scoped roster endpoints. These endpoints retain their existing authorization checks, safe member projections, membership synchronization, and projection reconciliation.
- Confirm before removing a member. Scoped removal explains that team positions, role, and qualifications are removed, while historical schedule assignments remain. Removing someone from a team never deletes their member record.
- Manage is available to administrators, global Teams editors, and editors of the current team. It opens Members with `editMember` and the originating `teamId`; leaving a dirty team draft uses the existing navigation guard. Returning restores the originating team editor.
- Global editors use the existing full member editor. A scoped manager can switch only among teams they can edit where the member is an active roster member. The team profile reads and writes go through `getTeamRosterMemberProfile` and `updateTeamRosterMemberProfile`; only that team's positions, role, and qualifications appear in the form. Switching teams or members is guarded when the profile has unsaved changes.
- Both editor modes use the same eligible-position, desired-position, team-role, and qualification controls. The scoped mode passes only the selected team's options and profile slice; it does not render inaccessible member fields.
- A scoped profile opens from Teams bootstrap data only when the server marks the full editable profile projection complete and the client verifies every referenced field and entity. Partial or malformed bootstrap data is never interpreted as an empty profile; it uses `getTeamRosterMemberProfile` for the authoritative team slice. Scoped saves continue through `updateTeamRosterMemberProfile`, whose server-side ownership checks remain authoritative.
- Scoped managers see Members grouped into `Your teams` and `Other members`, alphabetically within each group. Search and filters apply to both groups; names and team details outside their authorized projection are not included.
- The member list distinguishes `No team assigned` only when the server can establish that all active team rosters are complete. If ownership is truncated or malformed, it shows an unavailable status rather than inferring no assignment. Scoped managers only see the safe status enum and their authorized team details.

## Behavioral boundaries

The full member editor's Positions and Desired positions lists omit team filter chips. Positions remain limited to the member's selected teams, with all positions available when no team is selected; Desired positions retain their existing all-team scope. Search, saved position order, and automatic team membership when choosing an eligible position remain unchanged. **Approval source:** Remove the positions filter request, clarification selecting team filter chips, and correction preserving selected-team filtering, 2026-10-23.

Closing or canceling a Member editor stays on Members, removes `editMember` and `teamId`, preserves list search/filters and the mounted list scrollport, and retains the originating Team return action on the list. Opening another member retains that origin. Only explicit Back returns and restores the original Team selection, then consumes return metadata. Close, Cancel, and Back retain unsaved-change and active-save guards; Save does not leave Members. Team editors follow the same Close/Cancel versus Back separation. See the [editor action navigation contract](responsive-navigation.md#editor-action-navigation-contract). **Approval source:** Member Editor Navigation and Navigation Antipatterns request, 2026-10-23.

Member editor deep links identify the church, member, and selected team together. Changing either URL selection preserves a dirty draft until the existing discard confirmation is accepted; Stay retains the editor and its URL. Delayed profile loads cannot replace a newer member, team, or church. Scoped links resolve only against authorized team projections, and server authorization remains authoritative. Create new member from a scoped team editor uses the same navigation guard and retains the originating team for preselection. **Approval source:** current code-review correction request, October 23, 2026.

- The inline editor does not add a permission or expose the full roster, cross-team information, or sensitive member fields to scoped managers.
- The church-wide draft path and the scoped immediate-persistence path remain separate.
- Bootstrap profile readiness is a display optimization only. Missing fields, unresolved entity references, and malformed relationships use the restricted profile read; the restricted PATCH remains the only scoped save path.
- After a scoped save and roster refresh, switching teams uses the refreshed member projection so reopening a team preserves its saved profile. Regression coverage: `MemberManager.test.tsx` exercises save, readiness invalidation, refresh, switching away and back, and a subsequent role save. **Approval source:** current code-review correction request, 2026-10-23.
- Schedule assignments and unrelated team settings are not changed by a roster-only edit.
- `EntityMultiSelect` remains unchanged for other forms.
- Team role, position, and qualification setup, plus archive, delete, and access workflows remain unchanged by this contract.

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
- **Question/problem:** The inline Remove button adds visual noise to each assigned-member row.
- **Approved behavior:** Put Remove from team in the per-member Actions menu and show a trash icon beside it; retain the existing removal confirmation and permission paths.
- **Why:** Keep the roster easier to scan while leaving removal easy to find when needed.
- **Approval source/date:** Current user request dated 2026-10-23.
- **Affected workflow/contract:** Create/Edit Team membership; broader team roster behavior remains inventory-only.
- **Question/problem:** Editors currently need separate Team and Members workflows to manage someone whose team-specific profile needs attention.
- **Approved behavior:** Keep Manage on each assigned member for administrators, global Teams editors, and scoped editors of that team. Open that member in Members with the originating team selected and a return path to the team editor. Keep the full member form for global editors and provide scoped editors only the current team's positions, role, and qualifications through the existing restricted APIs. Guard dirty team and profile changes.
- **Why:** Team membership and team-specific profile changes should be reachable from one Members destination without changing the existing permission boundary.
- **Approval source/date:** Current user request dated 2026-10-23.
- **Affected workflow/contract:** Create/Edit Team → Members profile editing and return navigation.
- **Question/problem:** Scoped managers need to find people they manage without exposing hidden team assignments or treating an incomplete roster as proof that a person has no team.
- **Approved behavior:** Group scoped Members results into `Your teams` and `Other members`, preserve alphabetical order within each group, and apply search and filters to both. Show `No team assigned` only from a complete server-derived membership status; otherwise use a generic unavailable status and never include hidden team names or IDs.
- **Why:** The list can prioritize relevant people while preserving the server's projection and authorization boundaries.
- **Approval source/date:** Current user request dated 2026-10-23.
- **Affected workflow/contract:** Team-scoped Members list and member assignment summary.
- **Question/problem:** Administrator and scoped member editors use separate controls, and the scoped editor waits for a second profile request even when authorized bootstrap data already contains a complete team profile.
- **Approved behavior:** Share the position, desired-position, role, and qualification controls. Initialize the scoped editor from a complete authorized bootstrap profile; keep the restricted profile read for partial or malformed projections and keep the restricted team-profile PATCH as the save authority.
- **Why:** Keep the same editing experience for both roles while opening complete scoped profiles without another request and retaining team ownership validation.
- **Approval source/date:** Current user request dated 2026-10-23.
- **Affected workflow/contract:** Members profile editing for administrators and scoped team managers.

## Implementation references

- Entry point: `client/src/pages/Teams/pages/TeamsGroupsPage.tsx`
- Implementation: `client/src/pages/Teams/managers/TeamManager.tsx`, `client/src/pages/Teams/managers/MemberManager.tsx`, `client/src/pages/Teams/managers/TeamMemberProfileEditor.tsx`, `client/src/pages/Teams/managers/MemberTeamProfileFields.tsx`, `client/src/pages/Teams/components/TeamMembersEditor.tsx`, `client/src/api/auth.ts`, `server/teamsAuthHandlers.js`, `server/teamsBootstrapProjection.js`
- Tests: `client/src/pages/Teams/components/TeamMembersEditor.test.tsx`, `client/src/pages/Teams/managers/TeamManager.permissions.test.tsx`, `client/src/pages/Teams/managers/MemberManager.test.tsx`, `client/src/pages/Teams/teamsUtils.test.ts`, `server/teamsBootstrapProjection.test.js`, `server/teamsApi.test.js`

## Technical design notes

- Global edits update the team draft and use `updateTeam` with the captured baseline only when membership changed. The server applies the membership delta to its current roster so concurrent additions are retained.
- Scoped search returns safe display projections for active candidates and indicates when its sorted 20-result page is truncated. Scoped membership mutations synchronize team/member projection state, remove team-owned positions and qualifications where appropriate, and retain historical schedule assignments.
- Suggestions and assigned rows use `memberId` for identity. Names are display values only.
