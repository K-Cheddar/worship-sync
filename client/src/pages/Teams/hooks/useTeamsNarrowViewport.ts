import { useMediaQuery } from "../../../hooks/useMediaQuery";

/** Matches CreatePanel / Teams layout `max-lg` (below 1024px). */
export const TEAMS_NARROW_VIEWPORT_QUERY = "(max-width: 1023px)";

/** True when the create/edit panel is full-screen over the list. */
export const useTeamsNarrowViewport = (): boolean =>
  useMediaQuery(TEAMS_NARROW_VIEWPORT_QUERY);
