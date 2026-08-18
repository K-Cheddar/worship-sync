/**
 * Which controller an outline belongs to.
 *
 * Outlines are one flat pool in the `ItemLists` doc. Scoping them keeps each
 * controller's picker showing only its own: an auxiliary controller feeding a
 * lobby screen has nothing to do with Sunday's sanctuary outline, and mixing
 * them makes the operator pick the wrong one under time pressure.
 *
 * An absent scope means the presentation controller — every outline that
 * existed before this, and every outline the overlay controller shares.
 */
import { ItemList, ItemListDetails } from "../types";
import { PRESENTATION_CONTROLLER_ID } from "./controllerProfiles";

export const DEFAULT_OUTLINE_SCOPE = PRESENTATION_CONTROLLER_ID;

type ScopedOutline = Pick<ItemList, "controllerScope"> &
  Partial<Pick<ItemListDetails, "_id">>;

export const getOutlineScope = (
  outline: ScopedOutline | null | undefined,
): string => outline?.controllerScope?.trim() || DEFAULT_OUTLINE_SCOPE;

export const isOutlineInScope = (
  outline: ScopedOutline | null | undefined,
  scope: string,
): boolean => getOutlineScope(outline) === (scope || DEFAULT_OUTLINE_SCOPE);

/** Outlines belonging to one controller, in their existing order. */
export const filterOutlinesByScope = <T extends ScopedOutline>(
  outlines: T[],
  scope: string,
): T[] => outlines.filter((outline) => isOutlineInScope(outline, scope));

/**
 * Pick the outline a controller should open in.
 *
 * Prefers the one it had open, then the first in its scope. Returns undefined
 * when the controller has no outlines yet — the caller creates one rather than
 * borrowing another controller's, which is the failure mode that would put
 * sanctuary content on a lobby screen.
 */
export const resolveOutlineForScope = <T extends ScopedOutline & { _id: string }>(
  outlines: T[],
  scope: string,
  preferredId?: string | null,
): T | undefined => {
  const inScope = filterOutlinesByScope(outlines, scope);
  const preferred = preferredId
    ? inScope.find((outline) => outline._id === preferredId)
    : undefined;
  return preferred ?? inScope[0];
};
