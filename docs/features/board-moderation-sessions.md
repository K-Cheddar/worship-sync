# Feature Contract: Board Moderation sessions

**Contract status:** Confirmed product intent

**Approval source:** Current user request, 2026-10-15.

**Last reviewed:** 2026-10-15

## Purpose

Let moderators review discussion board and Restream activity and choose when to begin a fresh session without losing activity from today.

## Expected behavior

- When Board Moderation opens, evaluate the current board and Restream session after authoritative session data has loaded, including when either service is disconnected.
- Offer a persistent **Start fresh for today** suggestion when both sessions began on an earlier local calendar day and neither has activity today. The moderator can keep the current session instead.
- Treat an empty board as stale when its creation date is earlier and it has no posts today.
- When only one session is stale, offer a reset for that session only. Activity today protects that session from a suggested reset.
- Do not suggest a reset from incomplete board or Restream loading, failed board loads, or unavailable sync state.
- Remember a keep decision for the same board, Restream session, and local day. Re-evaluate when a session or local day changes.
- A suggested reset always requires confirmation. The existing confirmed-event automatic Restream reset behavior remains unchanged.
- Keep manual session controls available.

## Behavioral boundaries

- Elapsed time alone never resets either session.
- A reset suggestion never includes a board with posts from today or a Restream session with activity today.
- Archiving the board and starting a Restream session retain their existing API and persistence behavior.

## Product decisions

- **Question/problem:** How should moderators recover from sessions left over from an earlier service day?
- **Approved behavior:** Evaluate both session timestamps and actual activity on opening Board Moderation, offer persistent scoped reset choices, protect activity from today, and remember a keep decision for the same session identities.
- **Why:** Operators need a visible recovery path for empty stale boards and ended Restream sessions without interrupting today's activity.
- **Material alternative rejected:** Resetting automatically based on elapsed time or resetting both systems when only one is stale.
- **Approval source/date:** Current user request, 2026-10-15.

## Implementation references

- Entry point: Board Moderation.
- Implementation: `client/src/pages/BoardController.tsx`, `client/src/boards/boardUtils.ts`, `client/src/boards/BoardSessionFreshStartSuggestion.tsx`.
- Tests: `client/src/pages/BoardController.test.tsx`, `client/src/boards/boardUtils.test.ts`.
