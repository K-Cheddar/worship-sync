import {
  PanelsTopLeft,
  MonitorCog,
  Palette,
  Plug,
  ShieldCheck,
  Users,
  ArrowLeftRight,
  Settings2,
  type LucideIcon,
} from "lucide-react";

export type AccountTabId =
  | "people"
  | "setup"
  | "controllers"
  | "branding"
  | "integrations"
  | "workspace"
  | "data-transfer";

export type AccountSection = {
  id: AccountTabId;
  routePath: AccountTabId;
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
  group: AccountNavGroupId;
};

export type AccountNavGroupId = "access" | "service-tools" | "settings";

export type AccountNavGroup = {
  id: AccountNavGroupId;
  label: string;
  icon: LucideIcon;
  defaultSectionId: AccountTabId;
  sections: AccountSection[];
};

export const ACCOUNT_NAV_GROUPS: AccountNavGroup[] = [
  {
    id: "access",
    label: "Access",
    icon: Users,
    defaultSectionId: "people",
    sections: [
      {
        id: "people",
        routePath: "people",
        path: "/account/people",
        label: "People",
        description: "Invite teammates and see who has access.",
        icon: Users,
        group: "access",
      },
      {
        id: "setup",
        routePath: "setup",
        path: "/account/setup",
        label: "Devices & security",
        description:
          "Create link codes, manage trusted devices, and update recovery email from one place.",
        icon: ShieldCheck,
        group: "access",
      },
    ],
  },
  {
    id: "service-tools",
    label: "Service Tools",
    icon: MonitorCog,
    defaultSectionId: "controllers",
    sections: [
      {
        id: "controllers",
        routePath: "controllers",
        path: "/account/controllers",
        label: "Controllers",
        description:
          "Operator surfaces and the displays each one drives, so a second screen can run its own content.",
        icon: MonitorCog,
        group: "service-tools",
      },
      {
        id: "workspace",
        routePath: "workspace",
        path: "/account/workspace",
        label: "Workspace",
        description:
          "Choose which optional tools appear in the Current Service Workspace.",
        icon: PanelsTopLeft,
        group: "service-tools",
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings2,
    defaultSectionId: "branding",
    sections: [
      {
        id: "branding",
        routePath: "branding",
        path: "/account/branding",
        label: "Branding",
        description: "Mission, vision, logos, and brand colors for controllers.",
        icon: Palette,
        group: "settings",
      },
      {
        id: "integrations",
        routePath: "integrations",
        path: "/account/integrations",
        label: "Integrations",
        description:
          "Service Planning and future connections to sync names and overlay fields.",
        icon: Plug,
        group: "settings",
      },
      {
        id: "data-transfer",
        routePath: "data-transfer",
        path: "/account/data-transfer",
        label: "Data export",
        description: "Download members, teams, positions, services, and schedules as CSV files.",
        icon: ArrowLeftRight,
        group: "settings",
      },
    ],
  },
];

export const ACCOUNT_SECTIONS = ACCOUNT_NAV_GROUPS.flatMap((group) => group.sections);

const accountSectionById = new Map(
  ACCOUNT_SECTIONS.map((section) => [section.id, section]),
);

export const getAccountSection = (tabId: AccountTabId) =>
  accountSectionById.get(tabId) ?? ACCOUNT_SECTIONS[0];

export const getActiveAccountSection = (pathname: string) =>
  ACCOUNT_SECTIONS.find(
    (section) =>
      pathname === section.path || pathname.startsWith(`${section.path}/`),
  ) ?? ACCOUNT_SECTIONS[0];

export const getActiveAccountNavGroup = (pathname: string) =>
  ACCOUNT_NAV_GROUPS.find((group) =>
    group.sections.some(
      (section) =>
        pathname === section.path || pathname.startsWith(`${section.path}/`),
    ),
  ) ?? ACCOUNT_NAV_GROUPS[0];

export const parseLegacyAccountTab = (search: string): AccountTabId | null => {
  const tab = new URLSearchParams(search).get("tab");
  if (!tab || !accountSectionById.has(tab as AccountTabId)) {
    return null;
  }
  return tab as AccountTabId;
};

/** @deprecated Use `/account/{section}` paths. Kept for external redirects. */
export const getLegacyAccountTabPath = (tabId: AccountTabId) =>
  tabId === "people" ? "/account/people" : `/account/${tabId}`;
