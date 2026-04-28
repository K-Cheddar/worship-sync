# Overlay System Expert

You are working on the worship-sync stream overlay system. Use this deep context when debugging, adding, or modifying overlay types.

---

## Architecture at a Glance

Overlays are shown on the `/stream` page (a separate browser window) and previewed in the TransmitHandler panel on the overlay controller. There are two Redux state slots per overlay:

- `streamInfo.<overlayField>` — the **live** slot; what is currently on screen
- `prevStreamInfo.<overlayField>` — the **exiting** slot; what is animating out

`DisplayWindow.tsx` reads both slots and passes them to overlay components. Animation components (`useGSAP`) watch both and play enter/exit animations.

### Overlay types (single-overlay-at-a-time layer)

| Key | Has-data check | Empty factory |
|---|---|---|
| `participantOverlayInfo` | `hasParticipantOverlayData` | `emptyParticipantOverlay(t)` |
| `stbOverlayInfo` | `hasStbOverlayData` | `emptyStbOverlay(t)` |
| `qrCodeOverlayInfo` | `hasQrOverlayData` | `emptyQrOverlay(t)` |
| `imageOverlayInfo` | `hasImageOverlayData` | `emptyImageOverlay(t)` |
| `boardPostStreamInfo` | `hasBoardPostData` | `emptyBoardPostStreamInfo(t)` |

These are mutually exclusive: sending one evicts the others via `clearStreamOverlaysExcept`.

### Other stream fields (not in single-overlay layer)

- `bibleDisplayInfo`, `formattedTextDisplayInfo` — managed separately
- `slide`, `boxes`, `timerId` — slide content

---

## State Machine: Sending an Overlay

All "send" actions (`updateParticipantOverlayInfo`, `updateImageOverlayInfo`, etc.) follow this pattern **on the overlay controller**:

```
1. clearStalePrevStreamOverlaySlotsExcept(state, keep, t)
   — wipes *prev* slots for OTHER types that are already empty in stream
     (prevents replaying old exit animations on the next transition)

2. state.prevStreamInfo.<field> = state.streamInfo.<field>
   — move current live to exiting slot

3. state.streamInfo.<field> = { ...payload, time: t }
   — set the new live content

4. preserveClearedStreamOverlaysForTransition(state, keep)
   — copy any OTHER types that are STILL LIVE in streamInfo → prevStreamInfo
     (e.g. if image is live when participant is sent, image moves to prev for exit)

5. clearStreamOverlaysExcept(state.streamInfo, keep, t)
   — set all OTHER overlay slots in streamInfo to their empty factories at time t
```

`t = getNextStreamOverlayTimestamp(state)` — monotonically increasing, always ≥ Date.now().

---

## Firebase Sync (stream page)

`writePresentationSnapshotToFirebase` writes each overlay as a **separate top-level key** on the `presentation/` Firebase path:

```
stream_participantOverlayInfo
stream_stbOverlayInfo
stream_qrCodeOverlayInfo
stream_imageOverlayInfo
stream_formattedTextDisplayInfo
stream_boardPostStreamInfo
stream_itemContentBlocked
```

The stream page subscribes to each key individually via `onValueRef` in `globalInfo.tsx`. **Both the overlay controller and the stream page receive all updates** — the overlay controller gets its own Firebase echo.

All updates flow through:
```
Firebase → globalInfo.tsx updateFromRemote()
         → dispatch({ type: "debouncedUpdate<Type>" })
         → store listener predicate (timestamp guard)
         → dispatch(update<Type>FromRemote(payload))
         → reducer
```

**Critical**: `onValueRef` in `globalInfo.tsx` must include an entry for every overlay key, or that key will never reach the stream page.

---

## The `isEmptySlotFromSameTransition` Guard

### The Problem
When overlay A evicts overlay B (single-overlay pattern), the overlay controller writes two Firebase keys simultaneously:
- `stream_A`: new live data at time T
- `stream_B`: empty slot at time T (set by `clearStreamOverlaysExcept`)

The stream page receives these as **two separate `onValue` events** in non-deterministic order.

**Clear-first order** (B-empty arrives before A-live): safe — `clearStalePrevStreamOverlaySlotsExcept` in A's fromRemote action has a `isEmptySlotFromSameTransition` guard that keeps B in prev.

**Clear-last order** (A-live arrives first, then B-empty): the fromRemote reducer for B receives the empty update. At this point:
- `streamInfo.B.time === T` (set by clearStreamOverlaysExcept during A's action)
- Incoming `t === T` (same Firebase write)

`isEmptySlotFromSameTransition(cur, t)` returns `true` when `cur.time === t`. When true, the reducer **skips** the `else if` branch that would clear `prevStreamInfo.B` — preserving the exit animation data that A's action set up.

### Implementation in every `fromRemote` reducer

```ts
// OLD (buggy — overwrites exit animation in clear-last order):
} else if (!nextHasX) {
  state.prevStreamInfo.xOverlayInfo = emptyXOverlay(t);
}

// CORRECT:
} else if (!isEmptySlotFromSameTransition(cur, t)) {
  state.prevStreamInfo.xOverlayInfo = emptyXOverlay(t);
}
```

`isEmptySlotFromSameTransition(overlay, t)` is defined in `presentationSlice.ts`:
```ts
const isEmptySlotFromSameTransition = (overlay, t) =>
  Boolean(overlay?.time != null && overlay.time === t);
```

---

## Timestamp Predicate Guards (store.ts listeners)

Each `fromRemote` listener has a predicate that only fires when the incoming timestamp is **newer** than the current state. This prevents echoes and out-of-order updates.

For `boardPostStreamInfo`, add a **content bypass** for when the stream page loads after a post was already sent:
```ts
if (info.text?.trim() && !current?.text?.trim()) return true; // content bypass
return info.time > current.time;
```

---

## Checklist: Adding a New Overlay Type

- [ ] `client/src/types.ts` — add type, add optional field to `Presentation`
- [ ] `presentationSlice.ts` initial state — add empty value to `streamInfo` and `prevStreamInfo`
- [ ] `presentationSlice.ts` helpers — `emptyX(t)`, `hasXData`, add to `hasActiveStreamOverlay`
- [ ] `presentationSlice.ts` — add to `clearStreamOverlaysExcept`, `clearAllStreamOverlays`, `clearAllStreamOverlaysForTransition`, `clearStalePrevStreamOverlaySlotsExcept`, `preserveClearedStreamOverlaysForTransition`
- [ ] `presentationSlice.ts` — add `keep` union literal to all helper function signatures
- [ ] `presentationSlice.ts` — add `updateX` and `updateXFromRemote` actions
- [ ] `presentationSlice.ts` — add `getNextStreamOverlayTimestamp` entry (if has `time` field)
- [ ] `presentationSlice.ts` — add to `clearStream` / `clearAll` reducers
- [ ] `store.ts` — `writePresentationSnapshotToFirebase`: add `stream_x: streamInfo.x`
- [ ] `store.ts` — localStorage: `setItem("stream_x", JSON.stringify(...))`
- [ ] `store.ts` — add `updateXFromRemote` to the write listener exclusion list
- [ ] `store.ts` — add `debouncedUpdateX` listener with timestamp predicate
- [ ] `globalInfo.tsx` `onValueRef` — add `stream_x: Unsubscribe | undefined` in BOTH the type and initial value
- [ ] `globalInfo.tsx` `updateFromRemote` — add `stream_x: { info: data.stream_x, updateAction: "debouncedUpdateX" }`
- [ ] `DisplayWindow.tsx` — accept props, wire into visibility memos, render component
- [ ] New overlay component — use GSAP timeline refs (`useRef<GSAPTimeline | null>(null)`), `useGSAP` with `dependencies` array

---

## Common Bugs

### Image/overlay instantly disappears on stream page when another overlay is sent
**Cause**: `updateXFromRemote` uses `else if (!nextHasX)` instead of `else if (!isEmptySlotFromSameTransition(cur, t))`. In clear-last order, the empty Firebase update clears prev before the exit animation can play.
**Fix**: Replace the condition as shown in the guard section above.

### Exit animation replays on every Clear All
**Cause**: `prevStreamInfo.participant` is never cleared by `updateParticipantOverlayInfoFromRemote` when it has data and both cur/next are empty. The stale prev keeps triggering `isPrevOverlayVisibleAtMs` on each new `currentTime`.
**Fix**: Same `isEmptySlotFromSameTransition` guard — when a later-timestamp empty arrives (`cur.time !== t`), clear prev.

### Board post never appears on stream page
**Cause 1**: `onValueRef` in `globalInfo.tsx` was missing `stream_boardPostStreamInfo`.
**Cause 2**: Timestamp predicate too strict — add content bypass (`info.text?.trim() && !current?.text?.trim()`).

### GSAP animation fires once then stops working
**Cause**: `useGSAP` without timeline refs; GSAP scope cleanup kills the tween. 
**Fix**: Use `useRef<GSAPTimeline | null>(null)`, call `timeline.current?.clear()` before each new `gsap.timeline().fromTo(...)`.

---

## Key File Locations

| File | Role |
|---|---|
| `client/src/store/presentationSlice.ts` | All overlay state, reducers, helpers |
| `client/src/store/store.ts` | Firebase write listener, per-type debounced listeners, localStorage |
| `client/src/context/globalInfo.tsx` | Firebase `onValue` subscriptions (`onValueRef`), `updateFromRemote` dispatch |
| `client/src/components/DisplayWindow/DisplayWindow.tsx` | Visibility memos, renders all overlay components |
| `client/src/pages/Stream.tsx` | Stream page — must pass all overlay props to DisplayWindow |
| `client/src/pages/OverlayController/` | Operator UI for sending overlays |
