import type { AccessType } from "../context/globalInfo";

/**
 * App access tiers, widest to narrowest: `full` → `music` → `view` → `member`.
 *
 * `member` is for a volunteer who exists only to see their own schedule. It is
 * strictly narrower than `view`, and that relationship is the whole point of
 * this module.
 *
 * Most access checks were written as `access !== "view"` — "not view, therefore
 * allowed". Adding a narrower tier to that shape silently *grants* it
 * everything view is denied, which is the opposite of the intent. Routing every
 * such check through {@link isViewOnlyAccess} makes a new tier inherit view's
 * restrictions by construction instead of by remembering to update each site.
 *
 * Allowlist checks (`access: ["full", "view"]`) are already safe — an
 * unmentioned tier is excluded — and need no change.
 */

/** True for tiers that may look but not modify. Deny-side of every mutation check. */
export const isViewOnlyAccess = (access?: AccessType | null): boolean =>
  access === "view" || access === "member";

/**
 * True for a volunteer with no operator surface at all. Narrower than
 * {@link isViewOnlyAccess}: a `view` user still gets read-only controllers,
 * a `member` gets none.
 */
export const isMemberOnlyAccess = (access?: AccessType | null): boolean =>
  access === "member";
