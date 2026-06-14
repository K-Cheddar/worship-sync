import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/utils/cnHelper";
import Button from "../../components/Button/Button";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl";
import { ChurchLogoImg } from "../../components/ChurchLogoImg";
import Spinner from "../../components/Spinner/Spinner";
import SearchableSelect from "../../components/SearchableSelect";
import { getPublicTeamSchedule } from "../../api/auth";
import type {
  TeamRosterMember,
  TeamScheduleOccurrence,
  TeamSchedulePublicSnapshot,
} from "../../api/authTypes";
import {
  formatOccurrenceRowLabel,
  getSharedOccurrenceTiming,
} from "@/utils/teamScheduleOccurrences";
import { parsePlainDate } from "@/utils/plainDate";
import { buildScheduleExportModel } from "./schedule/scheduleExport";
import {
  buildPublicScheduleColumns,
  buildPublicServiceSlotCounts,
} from "./schedule/publicScheduleColumns";
import ScheduleExportTable from "./schedule/ScheduleExportTable";
import SchedulePdfExportButton from "./schedule/SchedulePdfExportButton";
import {
  type ScheduleExportLayout,
} from "./schedule/scheduleExportPdf";
import { getCellMemberIds } from "./teamsUtils";
import {
  readTeamSchedulePublicTheme,
  writeTeamSchedulePublicTheme,
  type TeamSchedulePublicTheme,
} from "./teamSchedulePublicTheme";
import {
  readTeamSchedulePublicLayout,
  writeTeamSchedulePublicLayout,
} from "./teamSchedulePublicLayout";
import {
  readTeamSchedulePublicHighlight,
  writeTeamSchedulePublicHighlight,
} from "./teamSchedulePublicHighlight";
import { boardHeaderClassName, boardFormSectionClassName, publicPageScrollClassName } from "./teamsStyles";

const HIGHLIGHT_NONE_VALUE = "__highlight_none__";

/** Collapse duplicate focus events when the window regains focus. */
const FOCUS_REFETCH_DEBOUNCE_MS = 500;
/** Stay under the public schedule rate limit (60 / 10 min). */
const FOCUS_REFETCH_MIN_INTERVAL_MS = 30_000;

const PUBLIC_SCHEDULE_LAYOUT_OPTIONS: {
  value: ScheduleExportLayout;
  label: string;
}[] = [
    { value: "grid", label: "Grid" },
    { value: "transpose", label: "By position" },
    { value: "byDate", label: "By date" },
  ];

const noDuplicates = new Set<string>();

const lightHeaderClassName =
  "shrink-0 rounded-xl border border-gray-200 bg-white p-6 shadow-sm";

const lightFormSectionClassName =
  "rounded-xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm";

const pageShellClassName = (theme: TeamSchedulePublicTheme) =>
  cn(
    publicPageScrollClassName,
    "px-4 py-4 pb-8",
    theme === "dark" ? "bg-stone-950 text-white" : "bg-gray-100 text-gray-900",
  );

const loadingShellClassName = (theme: TeamSchedulePublicTheme) =>
  cn(
    publicPageScrollClassName,
    "flex items-center justify-center",
    theme === "dark" ? "bg-stone-950 text-white" : "bg-gray-100 text-gray-900",
  );

const publicToolbarButtonClassName = (isDark: boolean) =>
  cn(
    !isDark &&
    "border-gray-300 bg-white text-gray-900 hover:border-gray-400 hover:bg-gray-100 hover:text-gray-900 active:border-gray-300 active:bg-gray-200 active:text-gray-900",
  );

const formatDateRange = (startDate: string, endDate: string) => {
  const format = (value: string) => {
    const parsed = value ? parsePlainDate(value) : undefined;
    return parsed
      ? parsed.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
      : "";
  };
  const start = format(startDate);
  const end = format(endDate);
  if (start && end) return `${start} – ${end}`;
  return start || end;
};

const formatChurchTeamEyebrow = ({
  churchName,
  teamName,
}: {
  churchName: string;
  teamName: string;
}) => [churchName, teamName].filter(Boolean).join(" · ");

const TeamSchedulePublic = () => {
  const { token: routeToken = "" } = useParams();
  const [params] = useSearchParams();
  const token = routeToken || params.get("token") || "";

  const [snapshot, setSnapshot] = useState<TeamSchedulePublicSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [highlightMemberId, setHighlightMemberId] = useState(
    readTeamSchedulePublicHighlight,
  );
  const [theme, setTheme] = useState<TeamSchedulePublicTheme>(readTeamSchedulePublicTheme);
  const [layout, setLayout] = useState<ScheduleExportLayout>(
    readTeamSchedulePublicLayout,
  );
  const lastFocusRefetchAtRef = useRef(0);

  const isDark = theme === "dark";

  useEffect(() => {
    writeTeamSchedulePublicTheme(theme);
  }, [theme]);

  useEffect(() => {
    writeTeamSchedulePublicLayout(layout);
  }, [layout]);

  useEffect(() => {
    writeTeamSchedulePublicHighlight(highlightMemberId);
  }, [highlightMemberId]);

  const toggleTheme = () => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  };

  const load = useCallback(
    (withSpinner = false) => {
      if (!token) {
        setError("This link is missing its token.");
        setLoading(false);
        return;
      }
      if (withSpinner) setLoading(true);
      getPublicTeamSchedule(token)
        .then((response) => {
          setSnapshot(response);
          setError("");
        })
        .catch((loadError) => {
          setError(
            loadError instanceof Error ? loadError.message : "Could not load this schedule.",
          );
        })
        .finally(() => setLoading(false));
    },
    [token],
  );

  useEffect(() => {
    load(true);
  }, [load]);

  // "Fresh on open": re-pull when the viewer returns to the tab, debounced so
  // rapid alt-tab cycles do not spam the public schedule endpoint.
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    const onFocus = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const now = Date.now();
        if (now - lastFocusRefetchAtRef.current < FOCUS_REFETCH_MIN_INTERVAL_MS) {
          return;
        }
        lastFocusRefetchAtRef.current = now;
        load(false);
      }, FOCUS_REFETCH_DEBOUNCE_MS);
    };

    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(debounceTimer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const exportMembers = useMemo<TeamRosterMember[]>(
    () =>
      (snapshot?.members || []).map(
        (member) =>
          ({
            memberId: member.memberId,
            firstName: member.name,
            lastName: "",
            churchId: "",
            positionIds: [],
          }) as unknown as TeamRosterMember,
      ),
    [snapshot?.members],
  );

  const serviceGroups = useMemo(() => {
    const occurrences = snapshot?.schedule.occurrences || [];
    const order: string[] = [];
    const byService = new Map<string, TeamScheduleOccurrence[]>();
    occurrences.forEach((occurrence) => {
      if (!byService.has(occurrence.serviceId)) {
        byService.set(occurrence.serviceId, []);
        order.push(occurrence.serviceId);
      }
      byService.get(occurrence.serviceId)?.push(occurrence);
    });
    return order.map((serviceId) => {
      const groupOccurrences = byService.get(serviceId) || [];
      return {
        serviceName: groupOccurrences[0]?.name || "Service",
        sharedTiming: getSharedOccurrenceTiming(groupOccurrences),
        occurrences: groupOccurrences,
      };
    });
  }, [snapshot?.schedule.occurrences]);

  const { columns } = useMemo(
    () =>
      buildPublicScheduleColumns({
        assignments: snapshot?.schedule.assignments,
        positions: snapshot?.positions || [],
      }),
    [snapshot?.schedule.assignments, snapshot?.positions],
  );

  // Slot counts scoped per service, so a position only stays active for the
  // services that actually use it — other services' positions go inactive and
  // drop out of the "By date" / "By position" views instead of leaking in.
  const serviceSlotCounts = useMemo(() => {
    const serviceIdByOccurrence = new Map<string, string>();
    (snapshot?.schedule.occurrences || []).forEach((occurrence) => {
      serviceIdByOccurrence.set(occurrence.occurrenceId, occurrence.serviceId);
    });
    const countsByService = buildPublicServiceSlotCounts({
      assignments: snapshot?.schedule.assignments,
      serviceIdByOccurrence,
    });
    return { serviceIdByOccurrence, countsByService };
  }, [snapshot?.schedule.assignments, snapshot?.schedule.occurrences]);

  const model = useMemo(() => {
    if (!snapshot) return null;
    return buildScheduleExportModel({
      churchName: snapshot.churchName,
      scheduleName: snapshot.schedule.name,
      dateRangeLabel: formatDateRange(
        snapshot.schedule.startDate,
        snapshot.schedule.endDate,
      ),
      columns,
      groups: serviceGroups.map((group) => ({
        serviceName: group.serviceName,
        timingLabel: [group.sharedTiming.sharedWeekday, group.sharedTiming.sharedTime]
          .filter(Boolean)
          .join(" · "),
        occurrences: group.occurrences.map((occurrence) => ({
          occurrenceId: occurrence.occurrenceId,
          rowLabel: formatOccurrenceRowLabel(occurrence, group.sharedTiming),
        })),
      })),
      requiredCountFor: (occurrenceId, positionId) => {
        const serviceId = serviceSlotCounts.serviceIdByOccurrence.get(occurrenceId);
        const counts = serviceId
          ? serviceSlotCounts.countsByService.get(serviceId)
          : undefined;
        return counts?.get(positionId) || 0;
      },
      assignments: snapshot.schedule.assignments,
      members: exportMembers,
      duplicateFirstNames: noDuplicates,
      highlightMemberId: highlightMemberId || undefined,
    });
  }, [columns, exportMembers, highlightMemberId, serviceGroups, serviceSlotCounts, snapshot]);

  // Only people actually on this schedule are worth offering as highlight targets.
  const highlightableMembers = useMemo(() => {
    const assigned = new Set<string>();
    Object.values(snapshot?.schedule.assignments || {}).forEach((row) => {
      Object.values(row || {}).forEach((cell) => {
        getCellMemberIds(cell).forEach((memberId) => assigned.add(memberId));
      });
    });
    return (snapshot?.members || [])
      .filter((member) => assigned.has(member.memberId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshot?.members, snapshot?.schedule.assignments]);

  useEffect(() => {
    if (!highlightMemberId || highlightableMembers.length === 0) return;
    const stillOnSchedule = highlightableMembers.some(
      (member) => member.memberId === highlightMemberId,
    );
    if (!stillOnSchedule) {
      setHighlightMemberId("");
    }
  }, [highlightMemberId, highlightableMembers]);

  const churchLogoUrl = snapshot?.churchLogoUrl?.trim() || "";

  if (loading) {
    return (
      <main className={loadingShellClassName(theme)}>
        <Spinner width="40px" borderWidth="4px" />
      </main>
    );
  }

  if (error || !snapshot || !model) {
    return (
      <main className={pageShellClassName(theme)}>
        <div className="mx-auto w-full max-w-4xl">
          <div
            className={cn(
              "rounded-xl border p-6",
              isDark
                ? "border-red-400/40 bg-red-950/40"
                : "border-red-200 bg-red-50 text-center shadow-sm",
            )}
          >
            <h1
              className={cn(
                "text-xl font-semibold",
                isDark ? "text-stone-50" : "text-gray-900",
              )}
            >
              Schedule unavailable
            </h1>
            <p
              className={cn(
                "mt-2 text-sm",
                isDark ? "text-red-100/80" : "text-red-700",
              )}
            >
              {error || "This schedule link is no longer valid."}
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={pageShellClassName(theme)}>
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <header className={isDark ? boardHeaderClassName : lightHeaderClassName}>
          <div className="flex items-start justify-between gap-3">
            <p
              className={cn(
                "text-xl font-semibold tracking-wide",
                isDark ? "text-amber-300" : "text-orange-600",
              )}
            >
              {formatChurchTeamEyebrow({
                churchName: snapshot.churchName,
                teamName: snapshot.teamName,
              })}
            </p>
            <Button
              variant="tertiary"
              svg={isDark ? Sun : Moon}
              iconSize="sm"
              aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
              className={cn("shrink-0", publicToolbarButtonClassName(isDark))}
              onClick={toggleTheme}
            >
              {isDark ? "Light theme" : "Dark theme"}
            </Button>
          </div>
          <div className="mt-3 flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            {churchLogoUrl ? (
              isDark ? (
                <ChurchLogoImg
                  src={churchLogoUrl}
                  variant="board-attendee"
                  alt={snapshot.churchName}
                />
              ) : (
                <img
                  src={churchLogoUrl}
                  alt={snapshot.churchName}
                  className="size-16 shrink-0 rounded-lg border border-gray-200 bg-white object-contain p-1 shadow-sm sm:size-20"
                />
              )
            ) : null}
            <h1 className="min-w-0 flex-1 text-3xl font-semibold sm:text-4xl">
              {snapshot.schedule.name}
            </h1>
          </div>
          <p
            className={cn(
              "mt-3 max-w-2xl text-sm leading-relaxed sm:text-base",
              isDark ? "text-stone-300" : "text-gray-600",
            )}
          >
            {formatDateRange(snapshot.schedule.startDate, snapshot.schedule.endDate)}
          </p>
        </header>

        <section
          className={cn(
            isDark ? boardFormSectionClassName : lightFormSectionClassName,
            "space-y-4",
          )}
        >
          <div className="flex flex-wrap items-end gap-2">
            <SearchableSelect
              className="min-w-56"
              variant={isDark ? "board-attendee" : "light"}
              label="Highlight name"
              ariaLabel="Highlight a person"
              placeholder="Search for your name…"
              value={highlightMemberId || HIGHLIGHT_NONE_VALUE}
              onChange={(value) =>
                setHighlightMemberId(value === HIGHLIGHT_NONE_VALUE ? "" : value)
              }
              options={[
                { label: "No one", value: HIGHLIGHT_NONE_VALUE },
                ...highlightableMembers.map((member) => ({
                  label: member.name,
                  value: member.memberId,
                })),
              ]}
            />
            <SchedulePdfExportButton model={model} layout={layout} />
          </div>

          <SegmentedControl
            ariaLabel="Schedule layout"
            variant={isDark ? "publicDark" : "publicLight"}
            value={layout}
            onChange={setLayout}
            options={PUBLIC_SCHEDULE_LAYOUT_OPTIONS}
            fullWidth
          />

          <ScheduleExportTable
            model={model}
            theme={isDark ? "board-attendee" : "light"}
            layout={layout}
          />
        </section>
      </div>
    </main>
  );
};

export default TeamSchedulePublic;
