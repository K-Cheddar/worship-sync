import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/utils/cnHelper";
import {
  buildTeamsReturnNavigationState,
  teamsRoutePathname,
  type TeamsReturnTo,
} from "../teamsReturnNavigation";

type TeamsCrossSectionLinkProps = {
  to: string;
  returnTo: TeamsReturnTo;
  className?: string;
  children: ReactNode;
};

const TeamsCrossSectionLink = ({
  to,
  returnTo,
  className,
  children,
}: TeamsCrossSectionLinkProps) => (
  <Link
    to={to}
    state={buildTeamsReturnNavigationState(returnTo, teamsRoutePathname(to))}
    className={cn("text-xs font-medium text-cyan-300 hover:text-cyan-200", className)}
  >
    {children}
  </Link>
);

export default TeamsCrossSectionLink;
