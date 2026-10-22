import type { ReactNode } from "react";
import { lineTabsListShellClassName } from "../../components/ui/tabs";
import { cn } from "../../utils/cnHelper";
import {
  microphoneCatalogGridClassName,
  panelClassName,
  panelHeaderPaddingClassName,
  panelScrollPaddingClassName,
  panelShellClassName,
  scheduleGridScrollClassName,
  scheduleGridFrameClassName,
  scheduleTabRootClassName,
  scheduleWorkspaceBodyRowClassName,
  scheduleWorkspaceMainColumnClassName,
  scheduleWorkspacePanelClassName,
  scheduleWorkspaceTabsClassName,
  teamsCreatePanelListClassName,
  teamsCompactEntityRowLayoutClassName,
  teamsManagerPageRootClassName,
  teamsPanelMaxHeightClassName,
} from "./teamsStyles";

const skeletonBar = "animate-pulse rounded bg-white/10";
type SkeletonRowVariant = "card" | "compact" | "member" | "icon" | "qualification";

const SkeletonStatus = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div
    className={teamsManagerPageRootClassName}
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label={label}
  >
    {children}
  </div>
);

const SkeletonPanelHeader = ({ withButton = true, compact = false, withMenu = false }: { withButton?: boolean; compact?: boolean; withMenu?: boolean }) => (
  <div className="flex items-center justify-between gap-3">
    <div className={cn(skeletonBar, compact ? "h-7 w-32" : "h-6 w-32")} />
    <div className="flex shrink-0 items-center gap-2">
      {withButton ? <div className={cn(skeletonBar, compact ? "h-8 w-36" : "h-9 w-36")} /> : null}
      {withMenu ? <div className={cn(skeletonBar, "size-8")} /> : null}
    </div>
  </div>
);

const SkeletonDescription = ({ compact = false }: { compact?: boolean }) => (
  <div className={cn(skeletonBar, "mt-1 w-full max-w-md", compact ? "h-5" : "h-4")} />
);

const SkeletonEntityRow = ({
  withNote = false,
  withExtraAction = false,
  variant = "card",
}: {
  withNote?: boolean;
  withExtraAction?: boolean;
  variant?: SkeletonRowVariant;
}) => variant !== "card" ? (
  <div className={cn("flex min-w-0 max-w-full rounded-lg border border-gray-800 bg-gray-950/40", teamsCompactEntityRowLayoutClassName)}>
    {variant === "member" ? (
      <div className={cn(skeletonBar, "size-8 shrink-0 rounded-full")} />
    ) : null}
    {variant === "icon" || variant === "qualification" ? (
      <div className={cn(skeletonBar, "size-7 shrink-0 rounded-md")} />
    ) : null}
    <div className="min-w-0 flex-1">
      <div className={cn(skeletonBar, "h-5 w-40 max-w-full")} />
      <div className={cn(skeletonBar, "mt-0.5 h-4 w-56 max-w-full")} />
      {variant === "qualification" ? <div className={cn(skeletonBar, "h-4 w-64 max-w-full")} /> : null}
    </div>
    <div className={cn(skeletonBar, "size-4 shrink-0")} />
  </div>
) : (
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
  variant = "card",
}: {
  count?: number;
  withNote?: boolean;
  withExtraAction?: boolean;
  variant?: SkeletonRowVariant;
}) => (
  <div className="space-y-2">
    {Array.from({ length: count }, (_, index) => (
      <SkeletonEntityRow
        key={index}
        withNote={withNote}
        withExtraAction={withExtraAction}
        variant={variant}
      />
    ))}
  </div>
);

const SkeletonManagerPanel = ({
  withSearch = true,
  rowCount = 4,
  withNote = false,
  withExtraAction = false,
  rowVariant = "card",
}: {
  withSearch?: boolean;
  rowCount?: number;
  withNote?: boolean;
  withExtraAction?: boolean;
  rowVariant?: SkeletonRowVariant;
}) => (
  <section
    className={cn(
      panelShellClassName,
      "flex flex-col",
      teamsPanelMaxHeightClassName,
      rowVariant !== "card" && cn("w-full min-w-0", teamsCreatePanelListClassName),
    )}
  >
    <div className={cn("shrink-0", panelHeaderPaddingClassName)}>
      <SkeletonPanelHeader compact={rowVariant !== "card"} withMenu={rowVariant === "member" || rowVariant === "compact"} />
      <SkeletonDescription compact={rowVariant !== "card"} />
    </div>
    {rowVariant !== "card" ? (
      <div className="mt-4 flex shrink-0 gap-2 px-4">
        <div className={cn(skeletonBar, "h-9 min-w-0 flex-1")} />
        <div className={cn(skeletonBar, "h-9 w-20 shrink-0")} />
      </div>
    ) : null}
    <div
      className={cn(
        "scrollbar-variable mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto",
        panelScrollPaddingClassName,
      )}
    >
      {withSearch && rowVariant === "card" ? <div className={cn(skeletonBar, "h-10 w-full max-w-sm")} /> : null}
      <SkeletonEntityRows
        count={rowCount}
        withNote={withNote}
        withExtraAction={withExtraAction}
        variant={rowVariant}
      />
    </div>
  </section>
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
  <div className={scheduleGridScrollClassName}>
    <div className={cn(scheduleGridFrameClassName, "min-w-lg")}>
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
  <div className="rounded bg-gray-800/80 p-2">
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
  <div className={scheduleWorkspaceTabsClassName}>
    <SkeletonScheduleTabs />
    <section className={cn(panelClassName, scheduleWorkspacePanelClassName)}>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
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
      <div className={scheduleWorkspaceBodyRowClassName}>
        <div className={scheduleWorkspaceMainColumnClassName}>
          <SkeletonScheduleGrid />
        </div>
        <SkeletonScheduleMembersPanel />
      </div>
    </section>
  </div>
);

const SkeletonPlansFilter = () => (
  <div className="rounded-lg border border-gray-700/80 bg-gray-900/35 p-3">
    <div className="grid items-end gap-3 md:grid-cols-[minmax(12rem,14rem)_auto_minmax(0,1fr)]">
      <div className="space-y-1.5">
        <div className={cn(skeletonBar, "h-4 w-16")} />
        <div className={cn(skeletonBar, "h-10 w-full")} />
      </div>
      <div className="rounded-md border border-gray-700/80 bg-gray-900/70 px-2.5 py-2">
        <div className={cn(skeletonBar, "h-4 w-20")} />
        <div className="mt-1.5 flex gap-1.5">
          <div className={cn(skeletonBar, "h-8 w-20")} />
          <div className={cn(skeletonBar, "h-8 w-20")} />
        </div>
      </div>
      <div className="rounded-md border border-gray-700/80 bg-gray-900/70 px-2.5 py-2">
        <div className={cn(skeletonBar, "h-4 w-12")} />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className={cn(skeletonBar, "h-8 w-20")} />
          ))}
        </div>
        <div className={cn(skeletonBar, "mt-2 h-3 w-44")} />
      </div>
    </div>
  </div>
);

const SkeletonPlanTile = () => (
  <div className="rounded-lg border border-gray-700/80 bg-gray-900/45 p-3">
    <div className="flex items-start gap-3">
      <div className="flex w-14 shrink-0 flex-col items-center gap-1 rounded-md border border-gray-700 bg-gray-950/70 p-2">
        <div className={cn(skeletonBar, "h-3 w-8")} />
        <div className={cn(skeletonBar, "h-6 w-8")} />
        <div className={cn(skeletonBar, "h-3 w-10")} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className={cn(skeletonBar, "h-5 w-44 max-w-full")} />
        <div className="flex flex-wrap gap-2">
          <div className={cn(skeletonBar, "h-5 w-24")} />
          <div className={cn(skeletonBar, "h-5 w-32")} />
        </div>
      </div>
      <div className={cn(skeletonBar, "h-9 w-24 shrink-0")} />
    </div>
  </div>
);

const SkeletonPlansGroups = () => (
  <div className="space-y-4">
    {Array.from({ length: 2 }, (_, groupIndex) => (
      <section key={groupIndex} className="space-y-2">
        <div className={cn(skeletonBar, "h-5 w-36")} />
        <div className="space-y-2">
          <SkeletonPlanTile />
          <SkeletonPlanTile />
        </div>
      </section>
    ))}
  </div>
);

export const TeamsPlansPageSkeleton = () => (
  <SkeletonStatus label="Loading plans">
    <div className="scrollbar-variable flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="shrink-0 space-y-4">
        <div className="flex items-center gap-2">
          <div className={cn(skeletonBar, "size-5 rounded")} />
          <div className={cn(skeletonBar, "h-6 w-20")} />
        </div>
        <div className={cn(skeletonBar, "h-4 w-full max-w-lg")} />
        <SkeletonPlansFilter />
      </div>
      <div className="min-h-0 flex-1">
        <SkeletonPlansGroups />
      </div>
    </div>
  </SkeletonStatus>
);

export const TeamsSchedulesPageSkeleton = () => (
  <SkeletonStatus label="Loading schedules">
    <div className={scheduleTabRootClassName}>
      <section className={cn(panelClassName, "shrink-0")}>
        <SkeletonPanelHeader withButton={false} />
        <SkeletonDescription />
        <SkeletonScheduleSelectRow />
      </section>
      <SkeletonScheduleWorkspace />
    </div>
  </SkeletonStatus>
);

export const TeamsMembersPageSkeleton = () => (
  <SkeletonStatus label="Loading members">
    <SkeletonManagerPanel rowVariant="member" />
  </SkeletonStatus>
);

export const TeamsPositionsPageSkeleton = () => (
  <SkeletonStatus label="Loading positions">
    <SkeletonManagerPanel rowVariant="compact" />
  </SkeletonStatus>
);

export const TeamsGroupsPageSkeleton = () => (
  <SkeletonStatus label="Loading teams">
    <SkeletonManagerPanel rowVariant="compact" />
  </SkeletonStatus>
);

export const TeamsRolesPageSkeleton = () => (
  <SkeletonStatus label="Loading team roles">
    <SkeletonManagerPanel rowVariant="icon" />
  </SkeletonStatus>
);

export const TeamsQualificationsPageSkeleton = () => (
  <SkeletonStatus label="Loading qualifications">
    <SkeletonManagerPanel rowVariant="qualification" />
  </SkeletonStatus>
);

export const TeamsServicesPageSkeleton = () => (
  <SkeletonStatus label="Loading services">
    <SkeletonManagerPanel withSearch={false} rowCount={3} />
  </SkeletonStatus>
);

const TeamsTemplateCardSkeleton = () => (
  <div className="flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0 flex-1 space-y-2">
      <div className={cn(skeletonBar, "h-4 w-40")} />
      <div className="flex flex-wrap items-center gap-1.5">
        <div className={cn(skeletonBar, "h-5 w-28")} />
        <div className={cn(skeletonBar, "h-5 w-36")} />
      </div>
    </div>
    <div className={cn(skeletonBar, "h-8 w-8 shrink-0 self-start")} />
  </div>
);

/** Template list cards while the church's templates are fetching. */
export const TeamsTemplatesListSkeleton = ({
  count = 3,
}: {
  count?: number;
}) => (
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label="Loading templates"
    className="space-y-2"
  >
    {Array.from({ length: count }, (_, index) => (
      <TeamsTemplateCardSkeleton key={index} />
    ))}
  </div>
);

export const TeamsTemplatesPageSkeleton = () => (
  <SkeletonStatus label="Loading templates">
    <section
      className={cn(
        panelShellClassName,
        "flex flex-col",
        teamsPanelMaxHeightClassName,
      )}
    >
      <div className={cn("shrink-0", panelHeaderPaddingClassName)}>
        <SkeletonPanelHeader />
        <SkeletonDescription />
      </div>
      <div
        className={cn(
          "scrollbar-variable mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto",
          panelScrollPaddingClassName,
        )}
      >
        <div className={cn(skeletonBar, "h-10 w-full max-w-sm")} />
        {Array.from({ length: 3 }, (_, index) => (
          <TeamsTemplateCardSkeleton key={index} />
        ))}
      </div>
    </section>
  </SkeletonStatus>
);

const TeamsMicrophoneRowSkeleton = () => (
  <div className="flex items-center gap-2.5 rounded-md border border-gray-800 bg-gray-900/60 px-2.5 py-2">
    <div className={cn(skeletonBar, "size-7 shrink-0")} />
    <div className="min-w-0 flex-1 space-y-1.5">
      <div className={cn(skeletonBar, "h-4 w-24")} />
      <div className={cn(skeletonBar, "h-3 w-16")} />
    </div>
  </div>
);

const TeamsMicrophonesManagerSkeletonBody = ({
  count = 4,
}: {
  count?: number;
}) => (
  <>
    <div
      className={cn(
        microphoneCatalogGridClassName,
        "min-h-0 flex-1 content-start overflow-y-auto pt-2",
      )}
    >
      {Array.from({ length: count }, (_, index) => (
        <TeamsMicrophoneRowSkeleton key={index} />
      ))}
    </div>
    <div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-800 pt-3">
      <div className={cn(skeletonBar, "h-9 w-40")} />
      <div className={cn(skeletonBar, "h-9 w-36")} />
    </div>
  </>
);

/** Microphone manager body while the church's mic list is fetching. */
export const TeamsMicrophonesListSkeleton = ({
  count = 4,
}: {
  count?: number;
}) => (
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label="Loading microphones"
    className="flex min-h-0 flex-1 flex-col gap-3"
  >
    <TeamsMicrophonesManagerSkeletonBody count={count} />
  </div>
);

export const TeamsMicrophonesPageSkeleton = () => (
  <SkeletonStatus label="Loading microphones">
    <section
      className={cn(
        panelShellClassName,
        "flex flex-col",
        teamsPanelMaxHeightClassName,
      )}
    >
      <div className={cn("shrink-0", panelHeaderPaddingClassName)}>
        <div className={cn(skeletonBar, "h-6 w-36")} />
      </div>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          panelScrollPaddingClassName,
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <TeamsMicrophonesManagerSkeletonBody />
        </div>
      </div>
    </section>
  </SkeletonStatus>
);

const TeamsFormFiltersSkeleton = () => (
  <div className="mb-3 rounded-md border border-gray-700/80 bg-gray-900/70 px-2.5 py-2">
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 items-center gap-2 sm:w-60 sm:shrink-0">
        <div className={cn(skeletonBar, "h-4 w-9 shrink-0")} />
        <div className={cn(skeletonBar, "h-9 min-w-0 flex-1")} />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className={cn(skeletonBar, "h-4 w-12")} />
        <div className="flex h-7 w-full items-center justify-between rounded-md bg-gray-800/80 px-2 lg:hidden">
          <div className={cn(skeletonBar, "h-3 w-20")} />
          <div className={cn(skeletonBar, "size-4")} />
        </div>
        <div className="hidden flex-wrap gap-1.5 lg:flex">
          {["w-20", "w-16", "w-20", "w-20", "w-20", "w-16"].map((width, index) => (
            <div key={index} className={cn(skeletonBar, "h-7", width)} />
          ))}
        </div>
        <div className={cn(skeletonBar, "h-3 w-40 max-w-full")} />
      </div>
    </div>
  </div>
);

const TeamsIntakeFormCardSkeleton = () => (
  <div className="flex flex-col gap-3 rounded-lg border border-gray-800 bg-gray-950/40 p-3">
    <div className="flex items-start justify-between gap-2">
      <div className={cn(skeletonBar, "h-5 w-40 max-w-full")} />
      <div className={cn(skeletonBar, "h-5 w-12 shrink-0")} />
    </div>
    <div className="mt-1 space-y-1.5">
      <div className={cn(skeletonBar, "h-5 w-64 max-w-full")} />
      <div className={cn(skeletonBar, "h-5 w-32")} />
      <div className={cn(skeletonBar, "h-3 w-48 max-w-full")} />
    </div>
    <div className="flex justify-end">
      <div className={cn(skeletonBar, "h-8 w-24")} />
    </div>
  </div>
);

export const TeamsFormsPageSkeleton = () => (
  <SkeletonStatus label="Loading forms">
    <section
      className={cn(
        panelShellClassName,
        "mx-auto flex w-full min-w-0 flex-col lg:max-w-3xl",
        teamsPanelMaxHeightClassName,
      )}
    >
      <div className={cn("shrink-0", panelHeaderPaddingClassName)}>
        <div className="flex items-center justify-between gap-3">
          <div className={cn(skeletonBar, "h-6 w-32")} />
          <div className={cn(skeletonBar, "h-8 w-40 shrink-0")} />
        </div>
        <div className={cn(skeletonBar, "mt-2 h-4 w-full max-w-md")} />
      </div>
      <div
        className={cn(
          "scrollbar-variable mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto",
          panelScrollPaddingClassName,
        )}
      >
        <TeamsFormFiltersSkeleton />
        <div className="space-y-2">
          <TeamsIntakeFormCardSkeleton />
          <TeamsIntakeFormCardSkeleton />
        </div>
      </div>
    </section>
  </SkeletonStatus>
);

export const TeamsMessagesPageSkeleton = () => (
  <SkeletonStatus label="Loading messages">
    <div className="mx-auto w-full max-w-5xl space-y-5 overflow-y-auto p-4 sm:p-6">
      <header className="space-y-2">
        <div className={cn(skeletonBar, "h-6 w-44")} />
        <div className={cn(skeletonBar, "h-4 w-full max-w-2xl")} />
      </header>
      <section className="space-y-5 rounded-xl border border-gray-700 bg-gray-900/40 p-4 shadow-sm sm:p-6">
        <div className="space-y-2">
          <div className={cn(skeletonBar, "h-5 w-32")} />
          <div className={cn(skeletonBar, "h-4 w-full max-w-lg")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className={cn(skeletonBar, "h-10 w-full")} />
          <div className={cn(skeletonBar, "h-10 w-full")} />
        </div>
        <div className="space-y-3 border-t border-gray-700 pt-4">
          <div className="space-y-2">
            <div className={cn(skeletonBar, "h-5 w-24")} />
            <div className={cn(skeletonBar, "h-4 w-full max-w-lg")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={cn(skeletonBar, "h-10 w-full")} />
            <div className={cn(skeletonBar, "h-10 w-full")} />
          </div>
          <div className="space-y-2 rounded-lg border border-gray-700 bg-gray-950/50 p-3">
            <div className={cn(skeletonBar, "h-9 w-full")} />
            <SkeletonEntityRows count={4} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-700 pt-4">
          <div className={cn(skeletonBar, "h-4 w-56 max-w-full")} />
          <div className={cn(skeletonBar, "h-9 w-36")} />
        </div>
      </section>
      <section className="space-y-3">
        <div className={cn(skeletonBar, "h-5 w-36")} />
        <SkeletonEntityRows count={2} withNote />
      </section>
    </div>
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
    case "roles":
      return <TeamsRolesPageSkeleton />;
    case "qualifications":
      return <TeamsQualificationsPageSkeleton />;
    case "services":
    case "service-settings":
      return <TeamsServicesPageSkeleton />;
    case "plans":
      return <TeamsPlansPageSkeleton />;
    case "templates":
      return <TeamsTemplatesPageSkeleton />;
    case "microphones":
      return <TeamsMicrophonesPageSkeleton />;
    case "forms":
      return <TeamsFormsPageSkeleton />;
    case "messages":
      return <TeamsMessagesPageSkeleton />;
    default:
      return <TeamsMembersPageSkeleton />;
  }
};
