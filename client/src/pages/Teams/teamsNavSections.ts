import {
  Award,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  ContactRound,
  GraduationCap,
  LayoutTemplate,
  Mic2,
  Settings2,
  UserRoundCog,
  Users,
} from "lucide-react";
import type { FunctionComponent, SVGProps } from "react";

export type TeamsNavDomain = "teams" | "services";

export type TeamsNavSection = {
  path: string;
  routePath: string;
  label: string;
  description: string;
  icon: FunctionComponent<SVGProps<SVGSVGElement>>;
  domain: TeamsNavDomain;
};

export const teamsNavSections: TeamsNavSection[] = [
  {
    path: "/teams-and-services/schedules",
    routePath: "schedules",
    label: "Schedules",
    description: "Assign people to services by position.",
    icon: CalendarDays,
    domain: "teams",
  },
  {
    path: "/teams-and-services/members",
    routePath: "members",
    label: "Members",
    description: "Keep roster details and availability current.",
    icon: ContactRound,
    domain: "teams",
  },
  {
    path: "/teams-and-services/positions",
    routePath: "positions",
    label: "Positions",
    description: "Define roles and position requirements.",
    icon: UserRoundCog,
    domain: "teams",
  },
  {
    path: "/teams-and-services/groups",
    routePath: "groups",
    label: "Teams",
    description: "Organize members into scheduling teams.",
    icon: Users,
    domain: "teams",
  },
  {
    path: "/teams-and-services/roles",
    routePath: "roles",
    label: "Team roles",
    description: "Define team roles for members.",
    icon: Award,
    domain: "teams",
  },
  {
    path: "/teams-and-services/qualifications",
    routePath: "qualifications",
    label: "Qualifications",
    description: "Define qualification areas and levels.",
    icon: GraduationCap,
    domain: "teams",
  },
  {
    path: "/teams-and-services/forms",
    routePath: "forms",
    label: "Forms",
    description: "Share intake forms and review submissions.",
    icon: ClipboardList,
    domain: "teams",
  },
];

/**
 * Services shares this same page/sidebar shell as a second "domain" (see
 * TeamsSidebarNav's Teams/Services switcher) — scheduling always happens for
 * a specific service, so keeping them together makes it easy to move between
 * "who's assigned" and "what's happening" for the same service.
 */
export const servicesNavSections: TeamsNavSection[] = [
  {
    path: "/teams-and-services/services",
    routePath: "services",
    label: "Services",
    description: "Open a dated service workspace and build its plan.",
    icon: CalendarRange,
    domain: "services",
  },
  {
    path: "/teams-and-services/templates",
    routePath: "templates",
    label: "Templates",
    description: "Build reusable orders of service to start plans from.",
    icon: LayoutTemplate,
    domain: "services",
  },
  {
    path: "/teams-and-services/microphones",
    routePath: "microphones",
    label: "Microphones",
    description: "Manage the church-wide microphone list for service plans.",
    icon: Mic2,
    domain: "services",
  },
  {
    path: "/teams-and-services/service-setup",
    routePath: "service-setup",
    label: "Service setup",
    description: "Manage service times and required positions.",
    icon: Settings2,
    domain: "services",
  },
];

const allTeamsNavSections = [...teamsNavSections, ...servicesNavSections];

export const getActiveTeamsNavSection = (pathname: string) =>
  allTeamsNavSections.find(
    (section) =>
      pathname === section.path || pathname.startsWith(`${section.path}/`),
  ) || teamsNavSections[0];

/** Which domain's subsections the sidebar should show — defaults to "teams"
 * (e.g. at the bare /teams-and-services root, which redirects into the Teams
 * domain). */
export const getActiveDomain = (pathname: string): TeamsNavDomain =>
  getActiveTeamsNavSection(pathname)?.domain || "teams";
