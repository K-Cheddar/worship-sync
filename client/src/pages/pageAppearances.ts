import {
  Building2,
  CalendarClock,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  ScrollText,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type PageAppearance = {
  icon: LucideIcon;
  iconColorClass: string;
};

type PageAppearanceKey =
  | "churchAdministration"
  | "teamsAndServices"
  | "resources"
  | "mySchedule"
  | "myTeams"
  | "serviceWorkspace"
  | "currentServiceViewer"
  | "boardModeration"
  | "creditsEditor";

export const PAGE_APPEARANCES = {
  churchAdministration: { icon: Building2, iconColorClass: "text-amber-300" },
  teamsAndServices: { icon: Users, iconColorClass: "text-cyan-300" },
  resources: { icon: FolderOpen, iconColorClass: "text-violet-300" },
  mySchedule: { icon: CalendarClock, iconColorClass: "text-teal-300" },
  myTeams: { icon: Users, iconColorClass: "text-cyan-300" },
  serviceWorkspace: { icon: LayoutDashboard, iconColorClass: "text-blue-300" },
  currentServiceViewer: { icon: ListChecks, iconColorClass: "text-indigo-300" },
  boardModeration: { icon: MessagesSquare, iconColorClass: "text-blue-300" },
  creditsEditor: { icon: ScrollText, iconColorClass: "text-pink-300" },
} satisfies Record<PageAppearanceKey, PageAppearance>;
