import {
  Palette,
  Plug,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

export type AccountTabId = "people" | "setup" | "branding" | "integrations";

export type AccountSection = {
  id: AccountTabId;
  routePath: AccountTabId;
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const ACCOUNT_SECTIONS: AccountSection[] = [
  {
    id: "people",
    routePath: "people",
    path: "/account/people",
    label: "People",
    description: "Invite teammates and see who has access.",
    icon: Users,
  },
  {
    id: "setup",
    routePath: "setup",
    path: "/account/setup",
    label: "Devices & security",
    description:
      "Create link codes, manage trusted devices, and update recovery email from one place.",
    icon: ShieldCheck,
  },
  {
    id: "branding",
    routePath: "branding",
    path: "/account/branding",
    label: "Branding",
    description: "Mission, vision, logos, and brand colors for controllers.",
    icon: Palette,
  },
  {
    id: "integrations",
    routePath: "integrations",
    path: "/account/integrations",
    label: "Integrations",
    description:
      "Service Planning and future connections to sync names and overlay fields.",
    icon: Plug,
  },
];

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

export const parseLegacyAccountTab = (search: string): AccountTabId | null => {
  const tab = new URLSearchParams(search).get("tab");
  if (!tab || !accountSectionById.has(tab as AccountTabId)) {
    return null;
  }
  return tab as AccountTabId;
};

export const accountSectionSelectOptions = ACCOUNT_SECTIONS.map((section) => ({
  value: section.path,
  label: section.label,
}));

/** @deprecated Use `/account/{section}` paths. Kept for external redirects. */
export const getLegacyAccountTabPath = (tabId: AccountTabId) =>
  tabId === "people" ? "/account/people" : `/account/${tabId}`;
