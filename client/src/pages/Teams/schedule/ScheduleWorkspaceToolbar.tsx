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

export const resolveSchedulePublicationStatus = (
  schedule: Pick<TeamSchedule, "scheduleId" | "published"> | null | undefined,
): "draft" | "published" | undefined => {
  if (!schedule || !isPersistedScheduleId(schedule.scheduleId)) return undefined;
  return schedule.published === false ? "draft" : "published";
};

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
  publicationStatus?: "draft" | "published";
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
  publicationStatus,
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
  const publicationButtonLabel = isPublicationPending
    ? publicationStatus === "draft" ? "Publishing…" : "Unpublishing…"
    : publicationStatus === "draft" ? "Publish" : "Unpublish";

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

  const hasLeadingControls = Boolean(membersControl || canEdit);

  return (
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
        {publicationStatus ? (
          <>
            {hasLeadingControls ? (
              <span aria-hidden className="hidden h-5 w-px bg-gray-700 lg:block" />
            ) : null}
            <div
              role="group"
              aria-label="Schedule publication"
              className="flex shrink-0 flex-nowrap items-center gap-2"
            >
              <span
                role="status"
                aria-label="Schedule publication status"
                className={`inline-flex min-h-8 items-center rounded-full border px-3 text-sm font-medium ${
                  publicationStatus === "draft"
                    ? "border-amber-700 bg-amber-950/40 text-amber-100"
                    : "border-emerald-800 bg-emerald-950/35 text-emerald-100"
                }`}
              >
                {publicationStatus === "draft" ? "Draft" : "Published"}
              </span>
              {canEdit ? (
                <Button
                  variant={publicationStatus === "draft" ? "secondary" : "tertiary"}
                  disabled={isScheduleActionPending}
                  isLoading={isPublicationPending}
                  onClick={onPublicationChange}
                >
                  {publicationButtonLabel}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
        {(publicationStatus || hasLeadingControls) ? (
          <span aria-hidden className="hidden h-5 w-px bg-gray-700 lg:block" />
        ) : null}
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
  );
};

export default ScheduleWorkspaceToolbar;
