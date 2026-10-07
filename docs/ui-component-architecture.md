# Client UI component ownership

## Canonical architecture

Browser/Radix primitives → `components/ui` → WorshipSync controls → domain compositions → pages and containers.

Radix imports belong in `components/ui`. Ordinary application actions and fields use Button, Input, TextArea, Select, Checkbox, Toggle and RadioButton. Modal owns the styled dialog shell; ConfirmDialog composes its confirmation actions. Meaningful domain compositions remain separate. Popover, DropdownMenu, ContextMenu, Tabs and Sheet remain distinct primitive families with their own semantics.

This refactor started from the `in-progress` checkout. Concurrent Electron CSP, presentation-preview measurement and release-note work was preserved; it is outside this refactor's implementation claims.

## Before / after behavior

Before: dialog shells and manually implemented confirmations had different focus/dismissal behavior. Guest removal used a browser confirmation. Feature code bypassed controls for rich selects, mixed checkbox state and externally labelled switches. A page dialog could be visually obscured by an open floating window.

After: Modal composes the owner-aware dialog primitives; confirmations and lightboxes share its focus, dismissal and stacking behavior. Busy actions block closing, Escape and outside dismissal. Guest removal shows an in-app confirmation and cancels it when its church/schedule owner changes or unmounts. Ordinary controls use the shared APIs.

Intentionally unchanged: domain content, permissions, network endpoints, request/response shapes, persistence, synchronization, Electron/IPC, assignment-save ordering, microphone/IEM selection and clearing, controller output, mobile target sizing and stream transparency. This is an incremental refactor with small accessibility, focus and action-safety corrections, not a visual redesign. Rich search/pickers and specialized interactive surfaces retain their interaction models.

## Components and APIs

| Family | Ownership and changes |
| --- | --- |
| Dialog | `ui/dialog` provides Radix behavior; DialogContent no longer creates a competing styled shell or internal close button. Modal keeps its existing sizes (`sm`, `md`, `lg`, `xl`, `2xl`, `fit`, `full`), header actions, scroll body, surface/backdrop classes and two stacking levels. It adds `busy`, `onCloseAutoFocus` and `descriptionId` for visible descriptive content. |
| Confirmation | ConfirmDialog adds controlled `open`, title/description or rich children, confirm/cancel labels, destructive styling, `busy`, callbacks and action-layout overrides. Async ownership and durable work remain with callers. |
| Button | The existing app Button remains canonical. Service-plan conflict choices compose it with `variant="none"`, wrapping and `aria-pressed`. A ChoiceCard abstraction was unnecessary for this single domain composition. |
| Select | The existing Option model retains ReactNode labels/groups/classes and adds `textValue` and `disabled`. Select accepts rich `selectedValueLabel`, `placeholder`, compact `size` and trigger accessibility attributes. Existing empty-string translation, grouping and controlled opening remain. Icons/secondary content live in option labels. |
| Checkbox | Accepts boolean or `"indeterminate"`; shows the mixed-state indicator and forwards accessibility attributes. Changes remain boolean to preserve existing state-setter callers. |
| Toggle | Accepts external labels/descriptions and other ARIA attributes without requiring a built-in label; `switchClassName` styles the control separately from its wrapper. |
| Radio | ui/RadioGroup owns Radix Item/Indicator exports. RadioButton composes them and preserves its labels, helper descriptions and appearance. |
| Fields | Existing Input/TextArea remain canonical. TextArea respects an explicit `id` for external labels. A Field shell was deferred: the existing wrappers have different adornment, numeric, focus, helper and editing behavior; factoring them here would expand scope without a clear simplification. |
| Popover/menu | `PopOver/PopoverPanel` is explicitly a closable panel composition of ui/Popover. Menu remains a data-driven DropdownMenu composition; ContextMenu remains separate. Unused legacy MenuItem was removed. |
| Loading | Spinner adds `xs` (14px), `sm` (16px), `md` (24px), `lg` (48px), optional accessible status naming and reduced-motion behavior. The legacy 48px default and width/border overrides remain. |

### Dialog ownership and stacking

Each open Modal has a non-clipping portal host. Nested selects, popovers, drawers and confirmations inherit it, keeping poppers outside the translated dialog surface. Floating-window dialogs still portal into their owner's independent host. Page-level dialogs sit above the dock using the existing floating-window stacking constant, rather than introducing another manager or scattered feature constants. Radix still owns focus scopes, outside interactions and Escape; Modal restores the captured connected opener or calls an explicit close-focus handler.

The extra host is necessary: raising a page dialog alone would hide its nested body-portalled controls behind it. Focused tests cover global dialog/select ownership, independent floating-window hosts, stacking, focus restoration, busy dismissal and cleanup.

## Migrated feature usages

- Dialogs: DeleteModal, workstation unlinking, SMS confirmation, portable imports, desktop/mobile install help, Teams batch sending, schedule guest removal, chat image lightbox and service-plan media/file pickers.
- Selects: position microphone/IEM defaults, schedule microphone/IEM selectors, overlay filtering and portable-import column/match/action selectors. Rich labels, assignment warnings and empty choices remain.
- Checkboxes/toggles: Teams message and availability select-all, service days, Bible bulk selection, member team scope, lyric import cards, schedule paste options, lyric song-order tools and notification preferences.
- Fields/actions: resource upload names, media display names, service-plan email message, schedule paste text, conflict choices and TimePicker list actions.
- Loading: portable import, content preview, login, BoardController, Restream panel, user sync status, lyrics searching and What's New. Higher-level loading/recovery experiences remain separate compositions.
- PopoverPanel: chat, account/setup, preview/QuickLink, rich text/color and toolbar consumers and their mocks.

## Boundary enforcement

The active ESLint configuration is `client/package.json` (`eslintConfig`); the separate `.eslintrc.mjs` is not the active ESLint 8 configuration.

`no-restricted-imports` rejects Radix outside ui, and rejects selected low-level Button/Input/Checkbox/Switch/Select/Textarea/dialog imports outside their canonical wrappers. It covers alias and relative import paths. Tests may mock those primitives; Radix remains restricted outside ui. The two segmented TimePicker input implementations have narrow exceptions. Popover, menus, Tabs and Sheet remain usable compositional primitives.

An ESLint stdin probe confirmed four expected restriction errors: direct Radix Dialog, alias ui/Button, relative `../ui/Input` and relative `../../components/ui/Select` imports. No global raw-JSX ban was added: it would misclassify the specialized controls below and create brittle exceptions.

## Individually audited intentional exceptions

Paths below are relative to `client/src`. The production-source audit excludes test mocks.

### Native file inputs

These all remain hidden or visually hidden file-selection implementation details, with domain-specific acceptance, refs and reset behavior:

| File | Purpose |
| --- | --- |
| chat/ChatWindow.tsx | Chat photo selection |
| components/ItemDetailsModal/SongAudioAttachment.tsx | MP3 selection |
| components/PortableDataTransfer/PortableDataImportDialog.tsx | CSV selection |
| containers/Media/MediaUploadInput.tsx | Multi-file media selection |
| pages/ResourceUploadDialog.tsx | Multi-file resource selection |
| pages/Controller/AccountFormSections.tsx | Branding logo selection |
| pages/Services/ServicePlanEditor.tsx | Planning Center PDF selection |
| pages/Teams/managers/MemberManager.tsx | Profile-photo selection |

### Other native fields

| File | Reason retained |
| --- | --- |
| components/CommaSeparatedPillsInput/CommaSeparatedPillsInput.tsx | Token-entry implementation with specialized keyboard/paste behavior |
| pages/Services/ServicePlanEmailModal.tsx | Recipient-pill entry; ordinary message field migrated |
| components/SearchableSelect.tsx | Search/combobox interaction, deliberately separate from basic Select |
| pages/Teams/schedule/ScheduleAssignmentPicker.tsx | Assignment-search combobox and active-result keyboard ownership |
| pages/Controller/ServicePlanningSyncFloatingWindow.tsx | Saved-plan search combobox with active-result navigation |
| components/VerificationCodeInput/VerificationCodeInput.tsx | Multi-input verification-code semantics |
| components/RehearsalPlayer/RehearsalPlayerWindow.tsx | Native playback-position and volume ranges |
| components/StyleEditor/StyleEditor.tsx | Visually hidden radio backing illustrated participant-position choices |
| components/DisplayWindow/DisplayEditor.tsx | Transparent, absolutely positioned editing textarea tied to slide geometry; wrapping it would alter presentation editing |
| pages/PreparedVideoSurfaces.tsx | Diagnostic video-surface strategy select and test-source checkboxes, not ordinary operator forms |
| pages/Support.tsx | Hidden, untabbable spam honeypot |
| components/ui/Calendar.tsx | Month/year select within the date primitive family |
| components/ui/Input.tsx; components/ui/Textarea.tsx | Browser implementation of the shared primitives |

### Remaining low-level imports

| Consumer | Intentional ownership |
| --- | --- |
| Button, Input, TextArea, Select, Checkbox, Toggle, Modal wrappers | Canonical app-control implementation |
| RadioButton | ui/RadioGroup Item/Indicator composition; no direct Radix |
| TimePickerCountdown.tsx; TimePickerTimer.tsx | Segmented numeric input composition with its own focus/editing model |
| ui/DatePicker.tsx; ui/DateRangePicker.tsx; ui/DateTimePicker.tsx | Date-family primitive composition of low-level Input/Button |
| ui/dialog.tsx | Optional primitive Footer close-action composition; no second dialog shell |
| ui primitives (Button, Checkbox, context-menu, dialog, DropdownMenu, Label, Popover, RadioGroup, Select, sheet, Slider, Switch, tabs) | All remaining direct Radix imports |

Production searches found no `window.confirm`, no manual `role="dialog"` shell, no ordinary feature-level low Button/Checkbox/Switch/Select/Textarea/dialog imports, and no unexplained ordinary native form fields. Existing test doubles may intentionally render dialog roles.

### Specialized loading/actions

RehearsalPlayerWindow and ServicePlanSetlist retain a loading/play/pause icon family in their playback controls. TransferProgress retains a non-spinning state icon. MediaAddControl retains its progress arc. ServicePlanningSyncFloatingWindow retains its refresh-action rotation. Those are domain states or progress geometry, not duplicate simple spinners. Specialized card/tile, range, canvas, docking and picker interactions remain separate; normal app actions compose Button.

## Final review

### Findings

Critical: None. High: None. Medium: None introduced by this refactor.

Low, pre-existing: the entity-icon color picker debounces its parent draft update. Submitting immediately after a swatch click can save before that color commits. This was reproduced with the original ColorField and PositionManager components. This refactor preserves that workflow; its existing integration assertion now waits for the committed draft color and still requires the same saved payload. A separate save/debounce ownership fix would be useful.

### Open questions / assumptions

None blocking. App-facing names and persisted/synchronized contracts stay stable. Confirmation callers own async work and provide busy state; the confirmation component owns modal semantics only.

### Verification gaps

Required: None after the successful checks recorded below.

Optional: native Electron service-session acceptance and exhaustive CI suites were not run. Browser checks used a disposable shared-control harness rather than a signed-in production church. Actual feature behavior was exercised by the focused integration suites. The temporary harness and its server were removed/stopped after acceptance.

### Pattern / learning opportunities

Use import restrictions and this exception inventory to prevent future drift. Introduce a Field or ChoiceCard only when another real composition demonstrates useful shared behavior. Do not force searchable comboboxes, sheets or specialized playback controls into unrelated abstractions.

### Final readiness

Ready with minor follow-up: no required implementation remains. The optional icon-color debounce fix is outside this behavior-preserving refactor.

## Verification record

All commands below ran successfully, except the intentional lint restriction probe described above, which correctly returned four errors. The focused Jest commands use `npm test --prefix client -- --runInBand --runTestsByPath` with the exact file lists appended below. No complete client/server suite was run.

- `npm run type-check --prefix client` (`tsc --noEmit`).
- `npm run lint:check --prefix client` (zero warnings).
- `npm run build:strict --prefix client` (strict lint plus production Vite/PWA build).
- `node --test server/releaseNotes.test.js` (release-note loader validation).
- `git diff --check`.
- Source/import/native-field/loading audits above.
- Browser acceptance at 1280×720 and 360×1100: shared fields and mixed state, rich/floating select selection, visible confirmation above floating tools, Escape and opener restoration, disabled busy actions and blocked busy Escape. Temporary viewport overrides were reset.


### Shared controls and fields — 19 suites, 133 tests

```text
src/components/Modal/Modal.test.tsx
src/components/Modal/DeleteModal.test.tsx
src/chat/ChatImageAttachment.test.tsx
src/components/Select/Select.test.tsx
src/components/ui/Select.test.tsx
src/components/Checkbox/Checkbox.test.tsx
src/components/Toggle/Toggle.test.tsx
src/components/RadioButton/RadioButton.test.tsx
src/components/FloatingWindow/FloatingWindowOverlay.test.tsx
src/components/PortableDataTransfer/PortableDataImportDialog.test.tsx
src/pages/Services/ServicePlanContentPanel.test.tsx
src/pages/Teams/pages/TeamsMessagesPage.test.tsx
src/containers/ServiceTimes/ServiceTimes.test.tsx
src/containers/Bible/Bible.test.tsx
src/containers/Media/MediaUploadInput.test.tsx
src/containers/ItemEditor/__tests__/AddSongSectionsDrawer.test.tsx
src/components/SongSections/ViewSongSectionsDrawer.test.tsx
src/pages/Controller/AccountFormSections.test.tsx
src/containers/ItemEditor/__tests__/LyricsEditor.test.tsx
```

### Teams/Schedule and Controller consumers — 20 suites, 209 tests

```text
src/pages/Teams/TeamsAndServices.test.tsx
src/pages/Teams/pages/TeamsMessagesPage.test.tsx
src/pages/Teams/components/AvailabilityFormSendFlow.test.tsx
src/pages/Teams/managers/PositionManager.navigation.test.tsx
src/pages/Teams/schedule/ScheduleMicrophoneSelect.test.tsx
src/pages/Teams/schedule/ScheduleAssignmentPicker.test.tsx
src/pages/Teams/schedule/ScheduleBoardView.test.tsx
src/pages/Teams/schedule/ScheduleEditForm.test.tsx
src/pages/BoardController.test.tsx
src/pages/Controller/CurrentServiceRestreamPanel.test.tsx
src/containers/Toolbar/ToolbarElements/UserSection.test.tsx
src/containers/Toolbar/ToolbarElements/BoxEditor.test.tsx
src/containers/Toolbar/ToolbarElements/Outlines.test.tsx
src/containers/Toolbar/ToolbarElements/SlideEditTools.test.tsx
src/components/ContentPreview/ContentPreviewDialog.test.tsx
src/components/WhatsNewModal/WhatsNewModal.test.tsx
src/pages/ResourceUploadDialog.test.tsx
src/pages/Services/ServicePlanEmailModal.test.tsx
src/components/TimePicker/ListBox.test.tsx
src/components/TimePicker/TimePickerCountdown.test.tsx
```

### Additional popover, input and caller checks — 7 suites, 74 tests

```text
src/chat/ChatWindow.test.tsx
src/containers/CreateItem/CreateItem.test.tsx
src/hooks/useAboutChangelogMenu.test.tsx
src/pages/Teams/PositionIconPicker.test.tsx
src/components/ColorField/ColorField.test.tsx
src/components/Input/Input.test.tsx
src/components/ui/Input.test.tsx
```

### Final placeholder/ownership review — 5 suites, 23 tests

```text
src/pages/Teams/schedule/ScheduleMicrophoneSelect.test.tsx
src/pages/Teams/managers/PositionManager.navigation.test.tsx
src/containers/Overlays/Overlays.selection.test.tsx
src/components/Modal/Modal.test.tsx
src/components/PortableDataTransfer/PortableDataImportDialog.test.tsx
```
