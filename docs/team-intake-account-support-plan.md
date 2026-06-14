# Team Intake — Account-User Support (v1 Plan)

Status: proposed
Owner: TBD
Related: `client/src/pages/Teams/TeamIntakePublic.tsx`, `server/teamsAuthHandlers.js`

## Summary

Today the team intake form is **public and anonymous**: a volunteer opens a tokenized
link, types their name, checks positions, marks availability/blockouts, and submits.
An admin then **manually matches** each submission to a roster member by name
(`selectIntakeMemberMatch` in `teamsSelectors`).

This plan adds a parallel, **account-aware** path for submitters who are logged in,
without changing or replacing the anonymous token flow. Logged-in users get their
identity resolved server-side, their name and known data pre-filled, only their teams
shown, and a single editable submission that lands **pre-matched** in the admin queue.

## Goals

- Auto-fill name for logged-in users (from their roster member, else their account).
- Show only the teams the user belongs to (still allow opting into others).
- Pre-fill known positions and existing blockout dates so users edit deltas.
- One editable submission per user per form (upsert), not a new row each time.
- Submissions arrive **pre-matched** to a roster member, shrinking the review queue.

## Non-goals (v1)

- Auto-applying submissions without admin review (deferred to v2 once the link is trusted).
- Adding structured first/last name to **all** accounts (separate, additive effort — see
  Invariants). v1 uses `splitDisplayName` for unlinked users.
- Replacing or deprecating the anonymous token flow.
- Notifications / in-app "a form is open" prompts (future).

## The foundation: account ↔ roster-member link

The app has two separate "person" concepts that are **not linked today**:

1. **Account / identity** — `userId`, `email`, single `displayName`
   (`AuthBootstrap.user`). Who "logged-in" means.
2. **Roster member** — `TeamRosterMember` with structured `firstName`/`lastName`,
   `positionIds`, `blockoutDates`. No account reference today. Teams reference people by
   `memberId`.

Everything below depends on resolving a logged-in `userId` to a `memberId`. **Link by
`userId`, never by name** — name remains display/prefill only.

### How a `userId` first becomes linked to a `memberId`

v1 link strategy (in priority order, server-side, on authenticated submit/preview):

1. **Already linked** — `TeamRosterMember.linkedUserId === session.userId`. Use it.
2. **Suggest, don't auto-link** — if unlinked, compute a name match
   (`normalizedName`) and offer it to the user as "Are you {name}?" They confirm →
   server writes `linkedUserId` onto that member. (Keeps the link explicit and correct.)
3. **No match** — user submits as a new person; on admin "Create member" (or an
   opt-in self-create), the new member is created with `linkedUserId` set.

> Rationale: name-based auto-linking is unreliable ("Mike" vs "Michael"); a one-time
> explicit confirmation makes every future submission instant and exact.

## Data model changes (all additive, optional)

### `TeamRosterMember` (`client/src/api/authTypes.ts` + server docs)
```ts
linkedUserId?: string | null;   // account this member belongs to
linkedEmail?: string | null;    // optional, for invite/notify later
```

### `TeamIntakeSubmission`
```ts
submittedByUserId?: string | null;  // session user who submitted (server-derived)
linkedMemberId?: string | null;     // resolved member at submit time, if known
```

Stored via the existing schemaless `setDoc(..., { merge })`, so no migration is needed —
absent fields read as undefined and normalize to defaults.

## Server changes (`server/teamsAuthHandlers.js`)

Add **session-aware** behavior beside the existing handlers. Two options; prefer (B):

- **(A)** New endpoints: `getTeamIntakePreviewAuthed`, `submitTeamIntakeAuthed`.
- **(B)** Same endpoints, but when a valid session + CSRF is present, branch into the
  authenticated path. Token-only requests behave exactly as today.

### Authenticated preview
- Derive `userId`/`churchId` **from the session**, never from client input.
- If `session.churchId !== form.churchId`, fall back to the anonymous response (no
  identity leakage across churches).
- Resolve the member (linked, or suggested-by-name candidate).
- Response additions (only for authenticated callers):
  ```ts
  viewer: {
    userId: string;
    displayName: string;
    member: { memberId; firstName; lastName } | null;   // if linked
    suggestedMember: { memberId; firstName; lastName } | null;  // if name-matched, unlinked
    memberTeamIds: string[];          // teams the member belongs to
    knownPositionIds: string[];       // pre-check these
    knownBlockoutRanges: BlockoutRange[];  // pre-load these
    existingSubmission: TeamIntakeSubmission | null;  // for edit
  }
  ```
- Keep returning all in-scope `teams`/`positions` (client decides what to expand/hide).

### Authenticated submit (upsert)
- Validate identity server-side; ignore any client-sent userId.
- **Upsert** keyed by `formId + submittedByUserId`: update the existing submission if
  present, else create. Set `submittedByUserId` and `linkedMemberId`.
- If the user confirmed a suggested member, write `linkedUserId` onto that member.
- Status stays `new`/`reviewed` (admin still reviews in v1). Do **not** auto-apply.
- Reuse `validateTeamIntakeSubmissionPayload`; first/last still required (prefilled).

### Admin review (`IntakeManager.tsx` + selectors)
- Show a badge when a submission is account-backed and already `linkedMemberId`
  ("Verified · {member name}") so admins can apply with one click / bulk-apply.
- `selectIntakeMemberMatch` keeps working for anonymous rows.

## Client changes

### `TeamIntakePublic.tsx`
- Detect a session via `GlobalInfoContext` (`loginState`/`userId`/`churchId`).
- If logged in **and** `churchId` matches the form, call the authenticated preview.
- Prefill:
  - **Name:** linked member's first/last; else `splitDisplayName(displayName)`
    (editable, never used for matching).
  - **Positions:** pre-check `knownPositionIds`.
  - **Blockouts:** pre-load `knownBlockoutRanges`.
- **Teams:** default to expanding only `memberTeamIds`; keep an "I can also serve
  on other teams" affordance to reveal the rest (don't hard-hide — people pick up
  new positions).
- If `existingSubmission` is present, load it and switch the CTA to "Update my
  availability"; show a "last submitted {date}" note.
- Anonymous users: unchanged behavior.

### Name helper (shared util)
```ts
// "Anna Maria Garcia" -> { firstName: "Anna", lastName: "Maria Garcia" }
// "Cher"              -> { firstName: "Cher", lastName: "" }
export const splitDisplayName = (displayName: string) => {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
};
```

### `client/src/api/auth.ts`
- Add the authenticated preview/submit calls (CSRF-protected) and `viewer` types.

## Forward-compatibility invariants (do not violate)

1. Submissions & roster members stay on **first/last** — never collapse to one name field
   (load-bearing for `normalizedName` matching and "First L." public schedule display).
2. Account↔member linking is an **optional** field on the member, never a required restructure.
3. Submission identity is **optional** fields on the submission.
4. Authenticated intake is layered **beside** the token flow, never replacing it.
5. Link by `userId`, not by name. Name is display/prefill only.
6. When first/last lands on all accounts later, it simply **replaces** `splitDisplayName`
   as a cleaner prefill source — no breaking change.

## Security & privacy

- All identity is **server-derived from the session**; never trust a client-sent userId.
- Identity-revealing fields (`viewer`, existing submission, known data) are returned
  **only** to authenticated sessions whose `churchId` matches the form.
- The public token grants **form access, not identity** — the anonymous response never
  includes `viewer` data.
- Authenticated submit requires CSRF; reuse existing session/CSRF middleware.
- Respect `appAccess` — verify `view`-level members may hit these endpoints for their
  own availability, scoped to their own church.

## Phasing

- **Milestone 1 — Link plumbing:** add optional fields; authenticated preview returns
  `viewer` with linked/suggested member, team filter, known positions/blockouts.
- **Milestone 2 — Prefill UX:** session detection + prefill + team-expand on the public
  form; `splitDisplayName`.
- **Milestone 3 — Editable upsert:** one submission per user/form; "Update my availability".
- **Milestone 4 — Pre-matched review:** admin badge + one-click/bulk apply for linked rows.
- **v2 (later):** trusted auto-apply, notifications, and structured first/last on accounts.

## Open questions

- Self-service member creation: may a logged-in user with no roster match create their own
  member record, or must an admin do it? (v1 default: admin-gated.)
- Multi-church accounts: confirm the session exposes the right `churchId` for the form.
- Auto-apply threshold for v2: what makes a link "trusted enough" to skip review?

## Test plan

- Anonymous flow unchanged (regression).
- Authenticated, linked member: name/positions/blockouts prefilled; teams filtered;
  edit updates the same submission.
- Authenticated, unlinked but name-matched: suggestion shown; confirming writes
  `linkedUserId`; next load is instant-linked.
- Authenticated, no match: submits as new; lands unlinked/pre-`submittedByUserId`.
- Cross-church session: falls back to anonymous; no identity leak.
- `splitDisplayName`: single token, multi-token, empty, extra whitespace.
