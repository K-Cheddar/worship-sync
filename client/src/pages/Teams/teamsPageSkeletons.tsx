import type { ReactNode } from "react";
import { lineTabsListShellClassName } from "../../components/ui/tabs";
import { cn } from "../../utils/cnHelper";
import { panelClassName } from "./teamsStyles";

const skeletonBar = "animate-pulse rounded bg-white/10";

const SkeletonStatus = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div
    className="space-y-4"
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label={label}
  >
    {children}
  </div>
);

const SkeletonPanelHeader = ({ withButton = true }: { withButton?: boolean }) => (
  <div className="flex items-center justify-between gap-3">
    <div className={cn(skeletonBar, "h-6 w-32")} />
    {withButton ? <div className={cn(skeletonBar, "h-9 w-36 shrink-0")} /> : null}
  </div>
);

const SkeletonDescription = () => (
  <div className={cn(skeletonBar, "mt-1 h-4 w-full max-w-md")} />
);

const SkeletonEntityRow = ({
  withNote = false,
  withExtraAction = false,
}: {
  withNote?: boolean;
  withExtraAction?: boolean;
}) => (
  <div className="flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0 flex-1 space-y-2">
      <div className={cn(skeletonBar, "h-4 w-40")} />
      <div className={cn(skeletonBar, "h-3.5 w-56 max-w-full")} />
      {withNote ? <div className={cn(skeletonBar, "h-3 w-48 max-w-full")} /> : null}
    </div>
    <div className="flex shrink-0 items-center gap-1 self-start">
      {withExtraAction ? <div className={cn(skeletonBar, "h-8 w-24")} /> : null}
      <div className={cn(skeletonBar, "h-8 w-16")} />
      <div className={cn(skeletonBar, "h-8 w-8")} />
    </div>
  </div>
);

const SkeletonEntityRows = ({
  count = 4,
  withNote = false,
  withExtraAction = false,
}: {
  count?: number;
  withNote?: boolean;
  withExtraAction?: boolean;
}) => (
  <div className="space-y-2">
    {Array.from({ length: count }, (_, index) => (
      <SkeletonEntityRow
        key={index}
        withNote={withNote}
        withExtraAction={withExtraAction}
      />
    ))}
  </div>
);

const SkeletonManagerPanel = ({
  withTeamSelect = false,
  withSearch = true,
  rowCount = 4,
  withNote = false,
  withExtraAction = false,
}: {
  withTeamSelect?: boolean;
  withSearch?: boolean;
  rowCount?: number;
  withNote?: boolean;
  withExtraAction?: boolean;
}) => (
  <section className={panelClassName}>
    <SkeletonPanelHeader />
    <SkeletonDescription />
    {withTeamSelect ? (
      <div className="mt-4 space-y-2">
        <div className={cn(skeletonBar, "h-3 w-12")} />
        <div className={cn(skeletonBar, "h-10 w-full max-w-xs")} />
      </div>
    ) : null}
    <div className="mt-4 space-y-2">
      {withSearch ? <div className={cn(skeletonBar, "h-10 w-full max-w-sm")} /> : null}
      <SkeletonEntityRows
        count={rowCount}
        withNote={withNote}
        withExtraAction={withExtraAction}
      />
    </div>
  </section>
);

const SkeletonSubmissionCards = ({ count = 2 }: { count?: number }) => (
  <div className="space-y-3">
    {Array.from({ length: count }, (_, index) => (
      <div
        key={index}
        className="rounded-md border border-gray-700 bg-gray-950/60 p-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className={cn(skeletonBar, "h-4 w-36")} />
            <div className={cn(skeletonBar, "h-3 w-48")} />
            <div className={cn(skeletonBar, "h-3 w-40")} />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className={cn(skeletonBar, "h-8 w-24")} />
            <div className={cn(skeletonBar, "h-8 w-20")} />
          </div>
        </div>
      </div>
    ))}
  </div>
);

const SkeletonScheduleSelectRow = () => (
  <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-2">
        <div className={cn(skeletonBar, "h-3 w-24")} />
        <div className={cn(skeletonBar, "h-10 min-w-56")} />
      </div>
      <div className={cn(skeletonBar, "h-9 w-32")} />
      <div className={cn(skeletonBar, "h-9 w-28")} />
      <div className={cn(skeletonBar, "h-9 w-32")} />
    </div>
    <div className={cn(skeletonBar, "h-9 w-24 shrink-0")} />
  </div>
);

const SkeletonScheduleTabs = () => (
  <div className={cn(lineTabsListShellClassName, "flex")}>
    <div className={cn(skeletonBar, "h-10 flex-1 rounded-l-xl")} />
    <div className={cn(skeletonBar, "h-10 flex-1 rounded-r-xl")} />
  </div>
);

const SkeletonScheduleGrid = () => (
  <div className="overflow-auto rounded-lg border border-gray-800">
    <div className="min-w-lg">
      <div className="flex border-b border-gray-800 bg-gray-950 p-2">
        <div className={cn(skeletonBar, "h-8 w-24 shrink-0")} />
        <div className={cn(skeletonBar, "ml-2 h-8 flex-1")} />
      </div>
      <div className="flex border-b border-gray-800 bg-gray-950 p-2">
        <div className={cn(skeletonBar, "h-7 w-24 shrink-0 opacity-0")} />
        <div className="ml-2 flex flex-1 gap-2">
          <div className={cn(skeletonBar, "h-7 flex-1")} />
          <div className={cn(skeletonBar, "h-7 flex-1")} />
          <div className={cn(skeletonBar, "h-7 flex-1")} />
        </div>
      </div>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex border-t border-gray-800 p-2">
          <div className={cn(skeletonBar, "h-9 w-24 shrink-0")} />
          <div className="ml-2 flex flex-1 gap-2">
            <div className={cn(skeletonBar, "h-9 flex-1")} />
            <div className={cn(skeletonBar, "h-9 flex-1")} />
            <div className={cn(skeletonBar, "h-9 flex-1")} />
          </div>
        </div>
      ))}
    </div>
  </div>
);

const SkeletonMemberChip = () => (
  <div className="rounded border border-gray-700 bg-gray-900/60 p-2">
    <div className={cn(skeletonBar, "h-4 w-28")} />
    <div className={cn(skeletonBar, "mt-1.5 h-3 w-36")} />
  </div>
);

const SkeletonScheduleMembersPanel = () => (
  <div className="flex w-full shrink-0 flex-col self-stretch overflow-hidden rounded-lg border border-gray-700 bg-gray-950/60 lg:w-80">
    <div className="flex h-full min-h-0 w-full flex-col p-3">
      <div className="shrink-0 space-y-2 text-center">
        <div className={cn(skeletonBar, "mx-auto h-4 w-24")} />
        <div className={cn(skeletonBar, "mx-auto h-3 w-full max-w-56")} />
      </div>
      <div className="mt-3 flex shrink-0 flex-col gap-2">
        <div className={cn(skeletonBar, "h-9 w-full")} />
        <div className={cn(skeletonBar, "h-10 w-full")} />
      </div>
      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2">
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonMemberChip key={index} />
        ))}
      </div>
    </div>
  </div>
);

const SkeletonScheduleWorkspace = () => (
  <>
    <SkeletonScheduleTabs />
    <section className={cn(panelClassName, "mt-4")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className={cn(skeletonBar, "h-5 w-5 shrink-0 rounded")} />
            <div className={cn(skeletonBar, "h-6 w-36")} />
          </div>
          <div className={cn(skeletonBar, "h-4 w-full max-w-sm")} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={cn(skeletonBar, "h-9 w-44 rounded-lg")} />
          <div className={cn(skeletonBar, "h-9 w-20")} />
          <div className={cn(skeletonBar, "h-9 w-36")} />
        </div>
      </div>
      <div className="mt-4 flex min-w-0 flex-col gap-4 lg:flex-row lg:items-stretch">
        <div className="min-w-0 flex-1">
          <SkeletonScheduleGrid />
        </div>
        <SkeletonScheduleMembersPanel />
      </div>
    </section>
  </>
);

export const TeamsSchedulesPageSkeleton = () => (
  <SkeletonStatus label="Loading schedules">
    <section className={panelClassName}>
      <SkeletonPanelHeader withButton={false} />
      <SkeletonDescription />
      <SkeletonScheduleSelectRow />
    </section>
    <SkeletonScheduleWorkspace />
  </SkeletonStatus>
);

export const TeamsMembersPageSkeleton = () => (
  <SkeletonStatus label="Loading members">
    <SkeletonManagerPanel withSearch />
  </SkeletonStatus>
);

export const TeamsPositionsPageSkeleton = () => (
  <SkeletonStatus label="Loading positions">
    <SkeletonManagerPanel withTeamSelect withSearch />
  </SkeletonStatus>
);

export const TeamsGroupsPageSkeleton = () => (
  <SkeletonStatus label="Loading teams">
    <SkeletonManagerPanel withSearch={false} />
  </SkeletonStatus>
);

export const TeamsServicesPageSkeleton = () => (
  <SkeletonStatus label="Loading services">
    <SkeletonManagerPanel withSearch={false} rowCount={3} />
  </SkeletonStatus>
);

export const TeamsFormsPageSkeleton = () => (
  <SkeletonStatus label="Loading forms">
    <SkeletonManagerPanel
      withSearch={false}
      rowCount={3}
      withNote
      withExtraAction
    />
    <section className={panelClassName}>
      <div className={cn(skeletonBar, "h-6 w-32")} />
      <div className="mt-3">
        <SkeletonSubmissionCards />
      </div>
    </section>
  </SkeletonStatus>
);

export const getTeamsSectionSkeleton = (routePath: string) => {
  switch (routePath) {
    case "schedules":
      return <TeamsSchedulesPageSkeleton />;
    case "members":
      return <TeamsMembersPageSkeleton />;
    case "positions":
      return <TeamsPositionsPageSkeleton />;
    case "groups":
      return <TeamsGroupsPageSkeleton />;
    case "services":
      return <TeamsServicesPageSkeleton />;
    case "forms":
      return <TeamsFormsPageSkeleton />;
    default:
      return <TeamsMembersPageSkeleton />;
  }
};
