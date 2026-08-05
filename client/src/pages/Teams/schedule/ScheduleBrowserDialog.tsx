import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Users } from "lucide-react";
import DateRangePicker from "@/components/ui/DateRangePicker";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import Modal from "../../../components/Modal/Modal";
import Select from "../../../components/Select/Select";
import type { TeamRecord, TeamSchedule, TeamScheduleSummary } from "../../../api/authTypes";
import { isActive } from "../teamsUtils";
import {
  emptyScheduleBrowserFilters,
  filterSchedulesForBrowser,
  type ScheduleBrowserStatus,
} from "./scheduleBrowserFilters";

type BrowsableSchedule = TeamSchedule | TeamScheduleSummary;

const STATUS_OPTIONS: { label: string; value: ScheduleBrowserStatus }[] = [
  { label: "Active", value: "active" },
  { label: "Archived", value: "archived" },
  { label: "All", value: "all" },
];

/** "Aug 1 – Aug 31, 2026", or a single date, or a plain note when undated. */
const formatScheduleRange = (schedule: BrowsableSchedule) => {
  const start = schedule.startDate || "";
  const end = schedule.endDate || "";
  if (!start && !end) return "No dates set";
  const format = (value: string) => {
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };
  if (!end || start === end) return format(start || end);
  return `${format(start)} – ${format(end)}`;
};

/**
 * Full, filterable list of a church's schedules. The header picker only offers
 * the most recent few per team; this is where an operator goes to find anything
 * older, archived, or on a team they don't usually work with.
 */
const ScheduleBrowserDialog = ({
  isOpen,
  onClose,
  schedules,
  teams,
  selectedScheduleId,
  initialTeamId = "",
  onSelectSchedule,
}: {
  isOpen: boolean;
  onClose: () => void;
  schedules: BrowsableSchedule[];
  teams: TeamRecord[];
  selectedScheduleId: string;
  /** Team the dialog opens narrowed to, matching the header's filter. */
  initialTeamId?: string;
  onSelectSchedule: (scheduleId: string) => void;
}) => {
  const [filters, setFilters] = useState({
    ...emptyScheduleBrowserFilters,
    teamId: initialTeamId,
  });

  // Re-seed each time it opens so it follows the header filter rather than
  // stranding whatever was set the last time it was used.
  useEffect(() => {
    if (!isOpen) return;
    setFilters({ ...emptyScheduleBrowserFilters, teamId: initialTeamId });
  }, [initialTeamId, isOpen]);

  const teamOptions = useMemo(
    () => [
      { label: "All teams", value: "" },
      ...teams
        .filter(isActive)
        .map((team) => ({ label: team.name, value: team.teamId })),
    ],
    [teams],
  );

  const rows = useMemo(
    () => filterSchedulesForBrowser({ schedules, teams, filters }),
    [filters, schedules, teams],
  );

  // Compared against "no filtering at all", not the seeded team: opening
  // pre-narrowed is still a filter, and the operator should have one click to
  // see every schedule.
  const hasFilters =
    filters.search.trim() !== "" ||
    filters.teamId !== "" ||
    filters.status !== "active" ||
    filters.startDate !== "" ||
    filters.endDate !== "";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="All schedules"
      size="lg"
      description="Search and filter every schedule in this church."
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Search"
            type="search"
            placeholder="Schedule or team name"
            value={filters.search}
            onChange={(value) =>
              setFilters((current) => ({ ...current, search: String(value) }))
            }
          />
          <Select
            label="Team"
            value={filters.teamId}
            options={teamOptions}
            onChange={(teamId) =>
              setFilters((current) => ({ ...current, teamId }))
            }
          />
          <Select
            label="Status"
            value={filters.status}
            options={STATUS_OPTIONS}
            onChange={(status) =>
              setFilters((current) => ({
                ...current,
                status: status as ScheduleBrowserStatus,
              }))
            }
          />
          <DateRangePicker
            label="Dates"
            value={{ startDate: filters.startDate, endDate: filters.endDate }}
            onChange={({ startDate, endDate }) =>
              setFilters((current) => ({ ...current, startDate, endDate }))
            }
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-gray-400" role="status">
            {rows.length === 1 ? "1 schedule" : `${rows.length} schedules`}
          </p>
          {hasFilters ? (
            <Button
              variant="tertiary"
              onClick={() => setFilters(emptyScheduleBrowserFilters)}
            >
              Clear filters
            </Button>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <p className="rounded-md border border-gray-700 bg-gray-950/50 p-4 text-sm text-gray-300">
            No schedules match these filters. Try a different team, status, or
            date range.
          </p>
        ) : (
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {rows.map(({ schedule, teamName }) => {
              const isSelected = schedule.scheduleId === selectedScheduleId;
              return (
                <li key={schedule.scheduleId}>
                  <button
                    type="button"
                    aria-current={isSelected ? "true" : undefined}
                    className={`flex w-full flex-col gap-1 rounded-md border p-3 text-left transition-colors ${
                      isSelected
                        ? "border-cyan-500 bg-cyan-950/30"
                        : "border-gray-700 bg-gray-950/40 hover:border-gray-500"
                    }`}
                    onClick={() => {
                      onSelectSchedule(schedule.scheduleId);
                      onClose();
                    }}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-100">
                        {schedule.name}
                      </span>
                      {schedule.archivedAt ? (
                        <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs uppercase tracking-wide text-gray-400">
                          Archived
                        </span>
                      ) : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
                      <span className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        {teamName || "No team"}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <CalendarDays
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden
                        />
                        {formatScheduleRange(schedule)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
};

export default ScheduleBrowserDialog;
