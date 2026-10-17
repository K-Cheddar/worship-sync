import { Link, useLocation } from "react-router-dom";
import type { ComponentProps } from "react";
import { usePendingTeamsNavigation, useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";
import { matchesTeamsNavPath } from "../teamsNavSections";
import { isUnmodifiedLeftClick } from "../../../hooks/usePendingRouteNavigation";

/** All workspace shortcuts share pending selection and unsaved-change handling. */
const TeamsNavigationLink = ({
  path, active, onNavigate, ...props
}: Omit<ComponentProps<typeof Link>, "to"> & {
  path: string;
  active?: boolean;
  onNavigate?: () => void;
}) => {
  const location = useLocation();
  const { pathname } = usePendingTeamsNavigation();
  const { requestNavigation } = useTeamsNavigationGuard();
  const selected = active ?? matchesTeamsNavPath(pathname || location.pathname, path);
  return (
    <Link
      {...props}
      to={path}
      aria-current={selected ? "page" : undefined}
      onClick={(event) => {
        if (!isUnmodifiedLeftClick(event)) return;
        event.preventDefault();
        requestNavigation(path, { onNavigated: onNavigate });
      }}
    />
  );
};

export default TeamsNavigationLink;
