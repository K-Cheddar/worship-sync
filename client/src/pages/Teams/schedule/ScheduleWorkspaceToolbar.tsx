import type { ReactNode } from "react";
import {
  CalendarDays,
  LayoutGrid,
  MoreHorizontal,
  Redo2,
  Undo2,
} from "lucide-react";
import Button from "../../../components/Button/Button";
import Menu from "../../../components/Menu/Menu";
import type { MenuItemType } from "../../../types";
import type { TeamSchedule } from "../../../api/authTypes";
import {
  OCCURRENCE_ORGANIZE_OPTIONS,
  type OccurrenceOrganizeMode,
} from "../occurrenceOrganizeMode";
import { isPersistedScheduleId } from "./scheduleNotificationHistory";
import type { TeamScheduleAdminLayout } from "../teamScheduleAdminLayout";

type ScheduleLayoutOption = {
  value: TeamScheduleAdminLayout;
  label: string;
};

type ScheduleLifecycleStatus = "virtual" | "draft" | "published";

const LIFECYCLE_BANNER_CONTENT: Record<
  ScheduleLifecycleStatus,
  { heading: string; description: string; className: string }
> = {
  virtual: {
    heading: "Schedule preview",
    description: "Not saved yet · Make an assignment to start a draft",
    className: "border-slate-700 bg-slate-900/50 text-slate-100",
  },
  draft: {
    heading: "Draft schedule",
    description: "Not published · Not visible to volunteers",
    className: "border-amber-500/40 bg-amber-950/35 text-amber-50",
  },
  published: {
    heading: "Published schedule",
    description: "Visible to volunteers",
    className: "border-emerald-800/70 bg-emerald-950/20 text-emerald-50",
  },
};

export const resolveSchedulePublicationStatus = (
  schedule: Pick<TeamSchedule, "scheduleId" | "published"> | null | undefined,
): "draft" | "published" | undefined => {
  if (!schedule || !isPersistedScheduleId(schedule.scheduleId)) return undefined;
  return schedule.published === false ? "draft" : "published";
};

export const getScheduleWorkspacePublicationClassName = (
  publicationStatus: "draft" | "published" | undefined,
) => publicationStatus === "draft"
  ? "border-amber-500/50 bg-amber-950/20"
  : undefined;

type ScheduleWorkspaceToolbarProps = {
  staffingSummary: ReactNode;
  membersControl?: ReactNode;
  canEdit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoBlockedByPendingSave: boolean;
  redoBlockedByPendingSave: boolean;
  autoFilling: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  undoShortcut: { undo: string; redo: string };
  onUndo: () => void;
  onRedo: () => void;
  pasteFromExcelControl?: ReactNode;
  autoFillMenuItem?: MenuItemType;
  lifecycleStatus?: ScheduleLifecycleStatus;
  isScheduleActionPending: boolean;
  isPublicationPending: boolean;
  onPublicationChange: () => void;
  showOrganizeOptions: boolean;
  organizeMode: OccurrenceOrganizeMode;
  onOrganizeModeChange: (mode: OccurrenceOrganizeMode) => void;
  scheduleLayout: TeamScheduleAdminLayout;
  scheduleLayoutOptions: ScheduleLayoutOption[];
  onScheduleLayoutChange: (layout: TeamScheduleAdminLayout) => void;
  moreMenuItems: MenuItemType[];
};

const ScheduleWorkspaceToolbar = ({
  staffingSummary,
  membersControl,
  canEdit,
  canUndo,
  canRedo,
  undoBlockedByPendingSave,
  redoBlockedByPendingSave,
  autoFilling,
  undoLabel,
  redoLabel,
  undoShortcut,
  onUndo,
  onRedo,
  pasteFromExcelControl,
  autoFillMenuItem,
  lifecycleStatus,
  isScheduleActionPending,
  isPublicationPending,
  onPublicationChange,
  showOrganizeOptions,
  organizeMode,
  onOrganizeModeChange,
  scheduleLayout,
  scheduleLayoutOptions,
  onScheduleLayoutChange,
  moreMenuItems,
}: ScheduleWorkspaceToolbarProps) => {
  const isDraft = lifecycleStatus === "draft";
  const publicationIdleLabel = isDraft ? "Publish" : "Unpublish";
  const publicationPendingLabel = isDraft ? "Publishing…" : "Unpublishing…";
  const publicationButtonLabel = isPublicationPending
    ? publicationPendingLabel
    : publicationIdleLabel;
  const lifecycleBanner = lifecycleStatus
    ? LIFECYCLE_BANNER_CONTENT[lifecycleStatus]
    : null;

  const schedulePreferenceItems: MenuItemType[] = [
    ...(showOrganizeOptions
      ? [{
        element: (
          <span className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4" aria-hidden />
            Organize
          </span>
        ),
        subItems: OCCURRENCE_ORGANIZE_OPTIONS.map((option) => ({
          text: `${organizeMode === option.value ? "✓ " : ""}${option.label}`,
          onClick: () => onOrganizeModeChange(option.value),
        })),
      }]
      : []),
    {
      element: (
        <span className="flex items-center gap-2">
          <LayoutGrid className="h-4 w-4" aria-hidden />
          Layout
        </span>
      ),
      subItems: scheduleLayoutOptions.map((option) => ({
        text: `${scheduleLayout === option.value ? "✓ " : ""}${option.label}`,
        onClick: () => onScheduleLayoutChange(option.value),
      })),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {lifecycleBanner ? (
        <div
          role="group"
          aria-label="Schedule status banner"
          className={`flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm ${lifecycleBanner.className}`}
        >
          <div
            role="status"
            aria-label="Schedule lifecycle status"
            className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5"
          >
            <strong className="shrink-0 font-semibold">{lifecycleBanner.heading}</strong>
            {" "}
            <span className="min-w-0 break-words text-current/80">{lifecycleBanner.description}</span>
          </div>
          {lifecycleStatus !== "virtual" && canEdit ? (
            <Button
              variant={lifecycleStatus === "draft" ? "secondary" : "tertiary"}
              disabled={isScheduleActionPending}
              isLoading={isPublicationPending}
              onClick={onPublicationChange}
            >
              {publicationButtonLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">{staffingSummary}</div>
        <div
          role="group"
          aria-label="Team schedule controls"
          className="flex min-w-0 flex-wrap items-center justify-start gap-x-2 gap-y-2 lg:justify-end"
        >
          {membersControl}
          {canEdit ? (
            <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Schedule editing history">
              <Button
                variant="tertiary"
                svg={Undo2}
                iconSize="sm"
                disabled={!canUndo || autoFilling || undoBlockedByPendingSave}
                onClick={onUndo}
                aria-label={undoLabel ? `Undo ${undoLabel}` : "Undo"}
                title={
                  undoBlockedByPendingSave
                    ? "Finish saving this assignment before undoing."
                    : undoLabel
                      ? `Undo ${undoLabel} (${undoShortcut.undo})`
                      : `Nothing to undo (${undoShortcut.undo})`
                }
              />
              <Button
                variant="tertiary"
                svg={Redo2}
                iconSize="sm"
                disabled={!canRedo || autoFilling || redoBlockedByPendingSave}
                onClick={onRedo}
                aria-label={redoLabel ? `Redo ${redoLabel}` : "Redo"}
                title={
                  redoBlockedByPendingSave
                    ? "Finish saving this assignment before redoing."
                    : redoLabel
                      ? `Redo ${redoLabel} (${undoShortcut.redo})`
                      : `Nothing to redo (${undoShortcut.redo})`
                }
              />
            </div>
          ) : null}
          {canEdit ? pasteFromExcelControl : null}
          <Menu
            align="end"
            menuItems={[
              ...(autoFillMenuItem ? [autoFillMenuItem] : []),
              ...schedulePreferenceItems,
              ...moreMenuItems,
            ]}
            TriggeringButton={
              <Button
                variant="tertiary"
                svg={MoreHorizontal}
                iconSize="sm"
                aria-label="More schedule actions"
              />
            }
          />
        </div>
      </div>
    </div>
  );
};

export default ScheduleWorkspaceToolbar;
