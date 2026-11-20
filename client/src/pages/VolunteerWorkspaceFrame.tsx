import { useEffect, useState, type ReactNode } from "react";
import type { PersonalScheduleAccess } from "./myScheduleOperations";
import VolunteerSelfServiceNavigation from "./VolunteerSelfServiceNavigation";

const COLLAPSED_SIDEBAR_KEY = "worshipsync.volunteerWorkspace.sidebarCollapsed";

const readCollapsedSidebar = () => {
  try {
    return window.sessionStorage.getItem(COLLAPSED_SIDEBAR_KEY) === "true";
  } catch {
    return false;
  }
};

const VolunteerWorkspaceFrame = ({
  access,
  active,
  children,
}: {
  access?: PersonalScheduleAccess;
  active: "schedule" | "availability";
  children: ReactNode;
}) => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsedSidebar);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(COLLAPSED_SIDEBAR_KEY, String(sidebarCollapsed));
    } catch {
      // Keep the current tab usable when storage is unavailable.
    }
  }, [sidebarCollapsed]);

  return (
    <section
      data-volunteer-workspace
      className="mt-0 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden border border-gray-700 bg-gray-900/40 lg:grid lg:grid-cols-[auto_minmax(0,1fr)]"
    >
      <VolunteerSelfServiceNavigation
        access={access}
        active={active}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      />
      <div
        data-testid="volunteer-workspace-scrollport"
        data-mobile-header-scroll-owner="workspace"
        className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-4 sm:px-6 lg:px-8"
      >
        <div className="mx-auto flex w-full max-w-[80rem] min-w-0 flex-col gap-4">
          {children}
        </div>
      </div>
    </section>
  );
};

export default VolunteerWorkspaceFrame;
