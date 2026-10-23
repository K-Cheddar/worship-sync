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
import { PAGE_APPEARANCES } from "./pageAppearances";

describe("PAGE_APPEARANCES", () => {
  it("matches the approved icon/color pair for every fixed destination", () => {
    expect(PAGE_APPEARANCES).toEqual({
      churchAdministration: { icon: Building2, iconColorClass: "text-amber-300" },
      teamsAndServices: { icon: Users, iconColorClass: "text-cyan-300" },
      resources: { icon: FolderOpen, iconColorClass: "text-violet-300" },
      mySchedule: { icon: CalendarClock, iconColorClass: "text-teal-300" },
      myTeams: { icon: Users, iconColorClass: "text-cyan-300" },
      serviceWorkspace: { icon: LayoutDashboard, iconColorClass: "text-blue-300" },
      currentServiceViewer: { icon: ListChecks, iconColorClass: "text-indigo-300" },
      boardModeration: { icon: MessagesSquare, iconColorClass: "text-blue-300" },
      creditsEditor: { icon: ScrollText, iconColorClass: "text-pink-300" },
    });
  });
});
