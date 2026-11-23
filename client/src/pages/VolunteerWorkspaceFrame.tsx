import type { ReactNode } from "react";

const VolunteerWorkspaceFrame = ({ children }: { children: ReactNode }) => (
  <section
    data-volunteer-workspace
    className="mt-0 flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
  >
    <div
      data-testid="volunteer-workspace-scrollport"
      data-mobile-header-scroll-owner="workspace"
      className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pb-[calc(1rem_+_env(safe-area-inset-bottom))] pt-4 sm:px-6 lg:px-8"
    >
      <div className="mx-auto flex w-full max-w-[80rem] min-w-0 flex-col gap-4">
        {children}
      </div>
    </div>
  </section>
);

export default VolunteerWorkspaceFrame;
