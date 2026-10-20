# Feature Contract: Team Chat Taskbar Notifications

**Contract status:** Confirmed product intent for Phase 1.

**Approval source:** WorshipSync — Phase 1: Windows Electron Taskbar Chat Notifications request, 2026-10-19.

**Last reviewed:** 2026-10-19

## Purpose

Let a controller operator notice unread team chat while using another Windows application, without adding another notification system.

## Operator workflow

The operator receives team messages in WorshipSync. If they are working elsewhere, the main controller taskbar button shows an unread marker and briefly requests attention for a new unread message. When the operator returns to the chat and views the latest messages, those messages are marked read as before.

## Expected behavior

- `ChatContext.unreadCount` remains the source for the persistent unread marker. Any positive count shows a small Windows taskbar overlay; zero clears it.
- Initial message history can show the unread overlay but never requests a flash.
- A genuinely new incoming unread message requests taskbar attention only when the main controller is unfocused. Newness is determined by message identity: an incoming message can flash when first observed with reactions, while reaction updates to a known message do not. The main process coalesces bursts and stops flashing on focus or after a bounded interval.
- Automatic read marking requires the chat content to be fully open, the controller document visible and focused, and the operator at the latest messages. A minimized, opening, restoring, or closing chat does not mark messages read. When focus or visibility returns while the chat is open at the latest messages, visible messages are marked read.
- Focusing or opening the main controller without an open chat does not clear unread messages.
- Logout, church or chat actor changes, renderer reload, renderer crash, and main-window closure clear stale taskbar state.

## Behavioral boundaries

- Phase 1 applies only to Windows Electron team chat and the main controller BrowserWindow.
- Projector, monitor, stream, display, utility, and browser surfaces cannot set the controller taskbar state.
- Existing chat toasts, reply/read flows, and media upload progress remain independent and unchanged.
- No system tray, desktop notification, numeric badge, or general activity framework is included.

## Important scenarios

| Scenario | Confirmed expected behavior | Current implementation or test evidence | Status / open question |
| --- | --- | --- | --- |
| Initial unread history | Show the unread marker without flashing | `ChatContext.notifications.test.tsx`; `chatTaskbar.test.ts` | Confirmed by current request |
| New incoming unread message | Request attention for a first-seen incoming, non-edited, non-deleted unread message; a known message's reaction update does not flash. Main process checks focus | `ChatContext.notifications.test.tsx`; `chatTaskbar.test.ts` | Confirmed by current request and review clarification |
| Read latest messages | Clear the marker when the unread count reaches zero | `ChatContext.notifications.test.tsx` | Confirmed by current request |
| Chat open in background or minimized | Keep incoming messages unread until chat content is fully open, visible, and focused at the latest position | `ChatContext.notifications.test.tsx`; `ChatWindow.test.tsx`; `FloatingWindow` phase callback | Confirmed by current request and review clarification |
| Account or renderer transition | Clear stale status and reject outdated updates | `ChatContext.notifications.test.tsx`; `chatTaskbar.test.ts` | Confirmed by current request |

## Product decisions

- **Question/problem:** How should Windows operators notice unread team chat when WorshipSync is behind another application?
- **Approved behavior:** Use a non-numeric unread overlay on the main controller taskbar icon and a coalesced, bounded flash for genuinely new unread messages while the controller is unfocused. Gate automatic reads on chat visibility and window focus.
- **Why:** Operators need to notice team activity while keeping existing chat read state and media progress behavior reliable.
- **Material alternative rejected:** System tray support, desktop notifications, numeric badges, and automatic read marking whenever the latest message is near the bottom, even in the background.
- **Approval source/date:** WorshipSync — Phase 1: Windows Electron Taskbar Chat Notifications request, 2026-10-19.
- **Affected workflow/contract:** Windows Electron team chat.
- **Review clarification (2026-10-20):** Automatic reads require the chat floating window to be fully open; minimized or transitioning chat content remains unread. Taskbar attention follows first-seen incoming message identity, so a new message already carrying reactions can alert while later reaction updates do not. Approved by the user's explicit response to the bounded fix design on 2026-10-20.

## Implementation references

- Entry point: `client/src/App.tsx`
- Implementation: `client/src/chat/ChatContext.tsx`, `client/src/chat/ChatWindow.tsx`, `client/electron/chatTaskbar.ts`, `client/electron/main.ts`, `client/electron/preload.ts`
- Tests: `client/src/chat/ChatContext.notifications.test.tsx`, `client/src/chat/ChatWindow.test.tsx`, `client/electron/chatTaskbar.test.ts`

## Technical design notes

The renderer sends a bounded scope, unread boolean, and increasing revision. The Electron main process validates the controller sender, stores only the latest status, and loads its fixed overlay from `buildResources/chat-unread-overlay.png`. Attention requests are separate from unread status and are accepted only for the active scope.
