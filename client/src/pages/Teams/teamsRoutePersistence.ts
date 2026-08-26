import {
  getActiveTeamsNavSection,
  servicesNavSections,
  teamsNavSections,
} from "./teamsNavSections";

export const TEAMS_AND_SERVICES_LAST_ROUTE_STORAGE_KEY =
  "worshipSync:teamsAndServices:lastRoute";

const allSections = [...teamsNavSections, ...servicesNavSections];

const isKnownRoute = (pathname: string) =>
  allSections.some(
    (section) =>
      pathname === section.path || pathname.startsWith(`${section.path}/`),
  );

export const getStoredTeamsAndServicesRoute = (): string | null => {
  try {
    const storedRoute = window.localStorage.getItem(
      TEAMS_AND_SERVICES_LAST_ROUTE_STORAGE_KEY,
    );
    return storedRoute && isKnownRoute(storedRoute) ? storedRoute : null;
  } catch {
    return null;
  }
};

export const saveTeamsAndServicesRoute = (pathname: string) => {
  if (!isKnownRoute(pathname)) return;

  // Persist the section root so a transient detail/edit URL is not restored
  // after a later visit to the Teams and Services shell.
  const section = getActiveTeamsNavSection(pathname);
  try {
    window.localStorage.setItem(
      TEAMS_AND_SERVICES_LAST_ROUTE_STORAGE_KEY,
      section.path,
    );
  } catch {
    // Storage can be unavailable in private browsing or embedded contexts.
  }
};
