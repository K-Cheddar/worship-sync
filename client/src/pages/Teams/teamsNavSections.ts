import {
  Award,
  CalendarDays,
  ClipboardList,
  ContactRound,
  GraduationCap,
  Settings2,
  UserRoundCog,
  Users,
} from "lucide-react";
import type { FunctionComponent, SVGProps } from "react";

export type TeamsNavSection = {
  path: string;
  routePath: string;
  label: string;
  description: string;
  icon: FunctionComponent<SVGProps<SVGSVGElement>>;
};

export const teamsNavSections: TeamsNavSection[] = [
  {
    path: "/teams/schedules",
    routePath: "schedules",
    label: "Schedules",
    description: "Assign people to services by position.",
    icon: CalendarDays,
  },
  {
    path: "/teams/members",
    routePath: "members",
    label: "Members",
    description: "Keep roster details and availability current.",
    icon: ContactRound,
  },
  {
    path: "/teams/positions",
    routePath: "positions",
    label: "Positions",
    description: "Define roles and position requirements.",
    icon: UserRoundCog,
  },
  {
    path: "/teams/groups",
    routePath: "groups",
    label: "Teams",
    description: "Organize members into scheduling teams.",
    icon: Users,
  },
  {
    path: "/teams/roles",
    routePath: "roles",
    label: "Team roles",
    description: "Define team roles for members.",
    icon: Award,
  },
  {
    path: "/teams/qualifications",
    routePath: "qualifications",
    label: "Qualifications",
    description: "Define qualification areas and levels.",
    icon: GraduationCap,
  },
  {
    path: "/teams/services",
    routePath: "services",
    label: "Services",
    description: "Manage service times used for scheduling.",
    icon: Settings2,
  },
  {
    path: "/teams/forms",
    routePath: "forms",
    label: "Forms",
    description: "Share intake forms and review submissions.",
    icon: ClipboardList,
  },
];

export const getActiveTeamsNavSection = (pathname: string) =>
  teamsNavSections.find(
    (section) =>
      pathname === section.path || pathname.startsWith(`${section.path}/`),
  ) || teamsNavSections[0];
