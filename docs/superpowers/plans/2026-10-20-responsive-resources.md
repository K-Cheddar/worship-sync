# Responsive Resources implementation

## Follow-up: compact filename disclosure

Final refinements requested in this session: remove colored icon backgrounds, use brighter 300-level icon colors on the existing dark operator surfaces, remove compact row vertical padding, and halve table header/body/skeleton padding from `py-3` to `py-1.5`. Before commit, all 195 tests across the same 11 focused suites passed, and the touch-browser fixture passed every width and theme with the final styling.

The subsequent October 20 request supersedes the original two-line filename design: names start as one truncated line, and touching the name toggles full wrapping in place. This follows the controller's `LastUpdatedByline` disclosure interaction. The name area uses a native button with `aria-expanded` and keyboard activation; icon/menu controls retain preview access without nesting interactive elements. State belongs to each name component, stays with its resource while sorting, and resets on rename/unmount. No APIs, persistence, desktop layout, selection, or preview navigation changes are involved. The earlier no-background and zero-vertical-padding follow-ups remain applied.

Required checks: a Resources regression test verifies collapsed -> expanded -> collapsed, Enter/Space, no accidental preview, and separate icon preview; the browser fixture verifies actual touch toggles, one-line collapsed height, full wrapped height, and no overflow in both theme classes at phone/tablet content widths. Review confirms independent sibling buttons and unchanged management handlers. No unresolved product choice remains; the current request is the authorization source.

## Goal
Implement the compact mobile file list and consistent file-type visuals requested on October 20, 2026.

## Existing architecture
Resources owns resource loading, filters, sorting, selection, confirmation, and preview navigation. ResourcePreview is local to the page. SelectedUploadFileRow has a second icon resolver. Shared DropdownMenu, Select, Checkbox, and Button controls provide existing keyboard and portal behavior.

## Before behavior
All widths render a 48rem table. Icons distinguish only broad categories. Upload icons and resource labels resolve independently.

## After behavior
Below 768px of available content width, render compact divided rows, a sort menu, explicit selection mode, and visible action menus. Larger widths retain the table. Both consume the same ordered entries and action handlers. File visuals use MIME, original filename, display filename, then media/kind fallbacks.

## Product Decision Check
No Resources-specific confirmed contract exists. The current detailed user request authorizes the mobile layout, sort and selection controls, file-type corrections, and existing capability-specific actions. No unresolved product choice remains. Record those decisions in docs/features/resources.md.

## Behavior intentionally unchanged
Resource APIs, persisted shapes, storage, providers, quota, previews and signed URL cache/prefetch, upload lifecycle, confirmation and reference-conflict behavior. Only full-access users manage church resources; virtual song attachments retain preview/download semantics.

## Acceptance criteria
All file families have consistent icons and readable labels; reliable metadata survives renames. One active responsive layout, no phone overflow, matching sort/navigation order, permission-aware actions, confirmation-backed selection, responsive loading/error/empty states.

## Proposed implementation
1. Test and implement a shared file-type resolver and icon; integrate upload rows and catalog type labels.
2. Extract existing preview and presentation helpers, preserving lifecycle and cache behavior. Reuse download handling from row menus.
3. Add a container-width subscription and mobile presentation using existing controls; keep state and transformations centralized in Resources.
4. Extend focused RTL coverage, run focused Jest, lint and TypeScript, then inspect responsive browser fixtures and the full diff.

## Affected surfaces
Authenticated Resources route uses GlobalInfoContext for church/access, ControllerInfoContext for DB, Redux song documents, and TransferProvider for upload activity. Existing page tests use those contexts and mock API/DB boundaries. No projector, monitor, stream, IPC, server, persistence, or synchronization changes.

## Risks / edge cases
Conflicting or empty MIME; renamed files; generic external links; no downloadable external bytes; selection of filtered church resources only; menu focus release before opening dialogs; resizing must never duplicate controls or reset ordering; failed deletion retains recovery.

## Questions requiring user input
None.

## Verification
Focused resolver/icon/upload/catalog/page tests including mobile sort, filtered preview navigation, permission menus, pending download, selection confirmation/cancel/conflict, and loading/errors. TypeScript and ESLint. Browser fixture at 375, 430, 768, 1024, and desktop with long names, keyboard menus, and light/dark styling. Review actual route/provider composition and deferred menus/dialogs. Full repository suites remain CI responsibility per AGENTS.md.

## Implementation record

Changed implementation files:
- `client/src/pages/Resources.tsx`: active layout, mobile controls, existing selection/confirmation handlers, shared icons. The page is smaller after extracting the preview. Desktop checkbox keyboard events no longer activate row preview.
- `client/src/components/ResourceMobileList.tsx`: compact rows, sort/selection controls, capability-specific overflow menus, mobile skeleton.
- `client/src/components/ResourcePreview.tsx`: extracted preview/cache descriptors and management behavior, shared download function, direct rename entry from row menus.
- `client/src/hooks/useResourceCompactLayout.ts`: container observation with cleanup and viewport fallback.
- `client/src/utils/resourceFileType.ts`, `resourceLibraryPresentation.ts`, `churchResourceCatalog.ts`: shared type resolution and existing presentation helpers.
- `client/src/components/ResourceFileIcon.tsx`, `SelectedUploadFileRow.tsx`: shared colored Lucide treatment; retained image thumbnail/progress/rename lifecycle.

Tests and supporting files:
- Extended `Resources.test.tsx` and `churchResourceCatalog.test.ts`.
- Added `ResourceFileIcon.test.tsx`, `resourceFileType.test.ts`, and `useResourceCompactLayout.test.tsx`.
- Added `client/e2e/resources-responsive.mjs` and its HTML/TSX fixture.
- Added `docs/features/resources.md`, registered it in `docs/features/README.md`, and added `release-notes/2026-10-20-mobile-resources.json`.
- Added this implementation plan and record. Existing unrelated working-tree edits were preserved.

## Final workflow review

### Findings
Critical: None. High: None. Medium: None. Low: None remaining.

Review found and corrected inherited no-wrap styling, desktop checkbox keyboard event propagation, and MIME/media fallback edge cases. Regression evidence includes failing-before/passing-after tests and a browser assertion requiring two filename lines.

### Product authorization status
Authorized by the current implementation request, recorded in the Resources feature contract. No backend, persistence, storage, or synchronized state changes. Permission boundaries apply in both layouts.

### Open questions / assumptions
None requiring product input. The container threshold is 768 CSS pixels, matching the table's minimum supported content width.

### Verification gaps
Production-context verification: Pass for this presentation scope. The real `/resources` route uses human AuthGate, GlobalInfoContext church/access, ControllerInfoContext DB, Redux songs/preferences, and TransferProvider upload activity. Browser coverage mounts the actual Resources page and workspace shell, with navigation/account chrome and API/DB boundaries stubbed. RTL uses faithful context wrappers and exercises deferred menus, rename, previews, and confirmation.

| Invariant | Controlled scenario and evidence | Result |
| --- | --- | --- |
| Sort and preview order agree | Each mobile sort dimension compared with table order; filtered descending navigation exercises real preview next; existing cache/neighbor tests retained | Pass |
| Deletion remains confirmed and recoverable | Select -> confirmation cancel -> accept -> reference conflict -> retained selection -> cancel selection; successful deletion exits mode | Pass |
| Capabilities stay distinct | Music/view cannot manage; virtual song download uses deferred promise with pending action disabled; external link has no download | Pass |
| One active responsive layout | Observer crosses 767/768 and disconnects at unmount; browser checks unique controls, wrapping, touch targets, keyboard menus, and overflow | Pass |
| Reliable metadata survives renames | External DOCX retains Google Drive/SharePoint/Dropbox source; specific MIME wins; upload/library icons match | Pass |

Actual successful checks from `client/`:
- `npm.cmd test -- --runInBand --runTestsByPath src/pages/Resources.test.tsx src/pages/ResourceUploadDialog.test.tsx src/pages/ExternalResourceDialog.test.tsx src/components/SelectedUploadFileRow.test.tsx src/utils/churchResourceCatalog.test.ts src/utils/resourceFileType.test.ts src/components/ResourceFileIcon.test.tsx src/hooks/useResourceCompactLayout.test.tsx src/components/ContentPreview/ContentPreviewDialog.test.tsx src/components/ContentPreview/contentPreview.test.ts src/components/ContentPreview/previewSourceCache.test.ts`: 11 suites, 194 tests passed.
- `npm.cmd run type-check`: passed.
- `npx.cmd eslint` on all 14 changed/new source and test files with `--max-warnings 0`: passed.
- `node e2e/resources-responsive.mjs`: passed at 320, 375, 430, 768, 1024, and 1440px in dark/light classes. Screenshots inspected at 375, 430, 768, 1024, and 1440px; no page overflow. Artifacts: `artifacts/resources-responsive/`.
- `git diff --check`: passed.

Optional additional confidence not performed: live authenticated backend, Electron interaction, and exhaustive repository CI suites. No changed IPC, backend, or storage behavior requires those for this scope.

### Pattern / learning opportunities
Reuse shared file-type presentation for future Resources consumers. No new repository policy needed.

### Final readiness
Ready for this workflow review scope; this is not a whole-branch production-readiness audit.

Cross-boundary review, sibling upload/preview search, legacy metadata compatibility, provider round trip, retry authority, permissions, and production/test composition comparison: performed. Observer lifetime cleanup is tested. Identity-switch and durable-operation retirement/compensation tests are not applicable to new render-only state and download menus; existing loading/upload/cache/deletion ownership paths are retained rather than redesigned.
