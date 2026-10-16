# Feature Contract: Discussion Board Controller

**Contract status:** Confirmed product intent for the responsive redesign; desktop service, data, and permission contracts remain as implemented.

**Approval source:** WorshipSync — Board Controller Mobile UX Redesign request, 2026-10-15; Board Controller Composer and Density Refinement request, 2026-10-16.

**Last reviewed:** 2026-10-16

## Purpose

Give moderators a clear workspace to review discussion board and Restream activity, moderate posts, and publish to the correct destination during a service.

## Operator workflow

Moderators select a board and session, review the unified chronological activity feed, hide or highlight current-session messages, and use Board Tools for session, presentation, sharing, and Restream controls. They can post to the discussion board or connected YouTube live chat from a shared mobile and desktop posting dock.

## Expected behavior

- The mobile toolbar stays visible at about 48px and contains Menu and compact account/sync controls. It omits the redundant Discussion Board title and does not add Teams and Services bottom navigation.
- The mobile context header shows the board, session, useful activity counts, and direct Board Tools access. Tapping the board name opens Manage Boards.
- The live feed is the main scroll region. Its compact Live activity heading keeps feed guidance available on demand. Cards show author, timestamp, source and status first, message content next, and permitted moderation actions below. The feed remains chronological. An operator who has scrolled up is not pulled to the latest activity by new messages and can return to the latest activity with a visible control.
- The shared mobile and desktop dock keeps compact tertiary **Board post** and **YouTube chat** actions in a stationary row. Only the selected destination expands above the row; the row stays content-sized on desktop and balanced on mobile.
- Composer expansion and collapse use a subtle 200ms ease-out transition and honor reduced-motion preferences. Inactive composers are inert and hidden from assistive technology. Each destination keeps its own draft when closed or switched.
- Composing does not cover the feed. The feed remains independently scrollable and retains its position when the composer opens, closes, switches, or sends. The controller layout follows the visual viewport while the mobile keyboard opens or closes. Failed sends retain the message and show a retryable error.
- Each composer prioritizes a flexible message field and compact Send action. The selected dock action toggles its composer closed, and Escape also closes it. YouTube resolves the connected channel's active livestream automatically. **Choose live stream** reveals the optional URL/video ID override only when automatic detection finds no active live chat.
- An old session that needs attention receives one actionable toast with Keep current and Start fresh actions. Keep current is remembered for that board session and local day. No duplicate persistent inline reminder is shown; manual session reset remains available in Board Tools.
- Historical sessions remain read-only for posting and moderation.
- Earlier-day board activity is offered through one actionable toast on mobile and desktop. Keep current is remembered for that board session and local day; the controller does not add a second persistent inline reminder.

## Behavioral boundaries

- Board switching, historical-session selection, new-session behavior, confirmations, presentation settings, sharing, and Restream controls keep their existing data and APIs.
- Board and YouTube messages retain separate APIs, validation, permissions, and sending behavior.
- The redesign applies only to the Discussion Board Controller. Desktop keeps its existing three-panel experience and uses the same posting dock interaction as mobile.
- No session is silently started, cleared, or reset.

## Important scenarios

| Scenario              | Confirmed expected behavior                                                   | Current implementation or test evidence                         | Status / open question       |
| --------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------- |
| Normal workflow       | Review unified activity and use direct mobile controls                        | `BoardController.tsx`; `BoardController.test.tsx`               | Confirmed by current request |
| Review older activity | Incoming messages do not move the feed; a latest-activity action is available | `useStickToBottomScroll.ts`; focused tests and browser geometry | Confirmed by current request |
| Switch composers      | Keep each destination's unsent draft                                          | Board and YouTube composer state                                | Confirmed by current request |
| Historical session    | Keep posting and moderation unavailable                                       | Board controller permission/session guards                      | Confirmed by current request |
| Old session           | Preserve the reminder and existing confirmation                               | Existing stale-session detection and fresh-session modal        | Confirmed by current request |
| Failure or retry      | Keep the draft and show the error in the active composer                      | Existing send APIs plus inline composer error                   | Confirmed by current request |

## Product decisions

- **Question/problem:** How should moderators use the Board Controller across screen sizes while keeping live activity available during composition?
- **Approved behavior:** Use a compact persistent toolbar and context header on mobile, preserve the desktop three-panel layout, and provide a shared dock that opens one inline composer above stationary actions while retaining separate drafts and the feed position. YouTube normally resolves its active livestream automatically and offers a URL override only when detection cannot find a live chat. Keep stale-session recovery in one actionable toast, with manual reset access in Board Tools.
- **Why:** The request identifies incoming activity visibility and immediate moderation/posting access as the primary mobile workflow.
- **Material alternative rejected:** Full-screen or feed-obscuring composers, stacked collapsed composers, hidden moderation actions, and automatic session resets.
- **Approval source/date:** WorshipSync — Board Controller Mobile UX Redesign request, 2026-10-15; Board Controller Composer and Density Refinement request, 2026-10-16.
- **Affected workflow/contract:** Responsive Discussion Board Controller and posting workflow.

## Implementation references

- Entry point: `client/src/pages/BoardController.tsx`
- Implementation: `client/src/boards/BoardControllerMenu.tsx`, `BoardControllerToolsPanel.tsx`, `BoardDiscussionPostComposer.tsx`, `BoardYouTubeChatComposer.tsx`, `BoardRestreamTabContent.tsx`, `client/src/hooks/useStickToBottomScroll.ts`
- Tests: `client/src/pages/BoardController.test.tsx`, composer tests, `client/e2e/board-controller-mobile.mjs`

## Technical design notes

Both destination composers remain mounted inside animated zero-height grid rows while inactive, so their local drafts survive destination switches without leaving collapsed content focusable. The posting action row is outside the feed scroll region. The page uses the visual viewport height when available so the flex layout can resize with a virtual keyboard. The existing follow-latest hook remains the authority for feed pinning.
