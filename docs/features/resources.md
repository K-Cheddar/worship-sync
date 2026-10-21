# Resources responsive file browsing

## Confirmed product intent

Authorization: the October 20, 2026 request to implement the responsive Resources redesign and shared file-type icons on `in-progress`.

Resources provides a compact file manager on phones and retains its sortable table when the available content width supports it. Mobile rows use a type icon, a single truncated filename line, compact metadata, and a visible action menu. Per the October 20 follow-up request, touching the name expands it in place to show its full text; touching it again collapses it. Enter/Space also toggle expansion, following the controller's LastUpdatedByline pattern. The icon and overflow menu retain preview access. Renaming resets expansion. Rows retain zero vertical padding and icons have no colored background, as requested in the earlier follow-ups. All five sort dimensions support ascending, descending, and default order through the same page state used by desktop and preview navigation.

Specific MIME and original filenames identify files before editable names and broad kind/media hints. Recognized external files retain their file type, and their source metadata retains the provider. Unknown external webpages remain links. Icons and text convey type independently of color in Resources and selected upload rows.

Full-access users can enter mobile selection mode for church resources, select all eligible filtered entries, and delete through the existing confirmation and API handlers. Cancellation or successful deletion exits selection. A failed deletion preserves recovery and reference-conflict behavior. Music and view access retain browsing, preview, and supported downloads. Song audio remains a virtual attachment and does not gain bulk selection, rename, or delete actions. External links do not gain a download action.

## Intentionally preserved

Loading and errors, storage quota, search/category filtering, signed URLs and preview caching/prefetch, upload/external-link dialogs, recent-item indicators, existing supported management behavior, persistence, APIs, schemas, and storage ownership.

## Implementation and verification

Resources owns transformations and action state. Only the active responsive layout mounts. Shared owner-aware controls handle menus, focus, and confirmation. The list changes at 768px of available content width, with a viewport fallback when ResizeObserver is unavailable.

Focused Jest tests cover resolver metadata precedence, icon/upload consistency, mobile sorting/navigation, permissions, pending download feedback, selection/confirmation/conflicts, and loading/error/empty states. The browser fixture uses the actual Resources page and workspace shell with API/DB boundary fixtures and checks responsive widths, themes, filename wrapping, overflow, keyboard menus, and touch targets.
