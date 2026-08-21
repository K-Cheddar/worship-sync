import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/utils/cnHelper";
import {
  buildTeamsReturnNavigationState,
  persistTeamsReturnTo,
  teamsRoutePathname,
  type TeamsReturnTo,
} from "../teamsReturnNavigation";
import { useTeamsNavigationGuard } from "../TeamsNavigationGuardContext";

type TeamsCrossSectionLinkProps = {
  to: string;
  returnTo: TeamsReturnTo;
  className?: string;
  "aria-label"?: string;
  children: ReactNode;
};

const TeamsCrossSectionLink = ({
  to,
  returnTo,
  className,
  "aria-label": ariaLabel,
  children,
}: TeamsCrossSectionLinkProps) => {
  const { requestNavigation } = useTeamsNavigationGuard();
  const state = buildTeamsReturnNavigationState(returnTo);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    requestNavigation(to, {
      state,
      // Persist only after the guard accepts the navigation. Rendering this
      // link, or cancelling a dirty-form prompt, must not create a return path.
      onNavigated: () => persistTeamsReturnTo(returnTo, teamsRoutePathname(to)),
    });
  };

  return (
    <Link
      to={to}
      state={state}
      aria-label={ariaLabel}
      className={cn("text-xs font-medium text-cyan-300 hover:text-cyan-200", className)}
      onClick={handleClick}
    >
      {children}
    </Link>
  );
};

export default TeamsCrossSectionLink;
