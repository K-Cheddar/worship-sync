import { TriangleAlert } from "lucide-react";
import { ServicePlanMicrophoneChip } from "../../../components/ServicePlanMicrophoneChip";
import { ServicePlanMicrophoneIcon } from "../../../components/ServicePlanMicrophoneIcon";
import {
  Select as RadixSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import type { ServicePlanMicrophone } from "../../../types/servicePlan";
import {
  teamMicrophoneSlotKey,
  type TeamsAssignmentSummaryRow,
} from "./teamsAssignmentsSummary";

/** Radix reserves "" — map "no mic" through a private sentinel. */
const NONE_MICROPHONE_VALUE = "__none__";

type TeamMicrophonesPanelProps = {
  /**
   * Scheduled rows that can hold a microphone — already narrowed by
   * `getTeamMicrophoneRows`, so this panel never has to know which teams opted
   * in.
   */
  rows: TeamsAssignmentSummaryRow[];
  microphones: ServicePlanMicrophone[];
  canEdit: boolean;
  /**
   * Whether this date's schedule cells are on the client. Schedules outside the
   * bootstrap's hydration window arrive without them, and the "assign people on
   * the schedule" guidance below would then be aimed at an operator who has
   * already done exactly that.
   */
  assignmentsStatus?: "ready" | "loading" | "unavailable";
  savingSlot?: string | null;
  onChange: (row: TeamsAssignmentSummaryRow, microphoneIds: string[]) => void;
};

type MicrophoneTeamGroup = {
  key: string;
  teamName: string;
  rows: TeamsAssignmentSummaryRow[];
};

/** One block per team (per schedule), in the order the rows arrive. */
const groupRowsByTeam = (
  rows: TeamsAssignmentSummaryRow[],
): MicrophoneTeamGroup[] => {
  const groups: MicrophoneTeamGroup[] = [];
  const byKey = new Map<string, MicrophoneTeamGroup>();
  for (const row of rows) {
    const key = `${row.teamId}::${row.scheduleId ?? ""}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    const group = { key, teamName: row.teamName, rows: [row] };
    byKey.set(key, group);
    groups.push(group);
  }
  return groups;
};

/**
 * Day-level microphone allocation for teams that opt in. It sits in its own
 * plan tab rather than inside the order of service: it answers who is expected
 * to hold each microphone for the whole service, before any item needs to
 * borrow one.
 */
const TeamMicrophonesPanel = ({
  rows,
  microphones,
  canEdit,
  assignmentsStatus = "ready",
  savingSlot,
  onChange,
}: TeamMicrophonesPanelProps) => {
  const microphoneById = new Map(
    microphones.map((microphone) => [microphone.id, microphone]),
  );
  const scheduledUseCount = new Map<string, number>();
  /** Who holds each mic, keyed by id — used to label options already in use. */
  const holdersByMicrophone = new Map<string, { slotKey: string; label: string }[]>();
  rows.forEach((row) => {
    const slotKey = teamMicrophoneSlotKey(row);
    const label = row.memberName || row.slotLabel;
    row.microphoneIds.forEach((microphoneId) => {
      scheduledUseCount.set(
        microphoneId,
        (scheduledUseCount.get(microphoneId) || 0) + 1,
      );
      const holders = holdersByMicrophone.get(microphoneId) || [];
      holders.push({ slotKey, label });
      holdersByMicrophone.set(microphoneId, holders);
    });
  });

  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-gray-400">
        Microphone allocations for this service&apos;s scheduled roles. Sharing
        is allowed; a warning helps the team spot it early.
      </p>

      {microphones.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-700 bg-black/20 px-3 py-4 text-xs text-gray-400">
          No microphones in the church list yet. Add them under Microphones in
          Teams and Services, then allocate them here.
        </p>
      ) : null}

      {assignmentsStatus !== "ready" ? (
        <p
          className="rounded-md bg-amber-950/40 px-3 py-2 text-xs text-amber-100"
          role="status"
        >
          {assignmentsStatus === "loading"
            ? "Loading this date's scheduled roles…"
            : "This date's scheduled roles haven't loaded, so some may be missing. Open the schedule to see them."}
        </p>
      ) : null}

      {rows.length === 0 && assignmentsStatus === "ready" ? (
        <p className="rounded-md border border-dashed border-gray-700 bg-black/20 px-3 py-4 text-xs text-gray-400">
          No scheduled roles for teams that use microphones yet. Assign people
          on the schedule, then allocate microphones here.
        </p>
      ) : null}

      {groupRowsByTeam(rows).map((group) => (
        <section key={group.key} className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-orange-300/90">
            {group.teamName}
          </h4>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
            {group.rows.map((row) => {
              const slotKey = teamMicrophoneSlotKey(row);
              const sharedMicrophones = row.microphoneIds.filter(
                (microphoneId) => (scheduledUseCount.get(microphoneId) || 0) > 1,
              );
              // One mic per scheduled role; keep the first if older data had several.
              const selectedId = row.microphoneIds[0] || "";
              const selectedMicrophone = selectedId
                ? microphoneById.get(selectedId)
                : undefined;
              const selectValue = selectedId || NONE_MICROPHONE_VALUE;
              return (
                <li
                  key={slotKey}
                  className="rounded-md border border-gray-800 bg-gray-900/60 p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    {row.memberProfileImageUrl ? (
                      <img
                        src={row.memberProfileImageUrl}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded-full object-cover"
                      />
                    ) : null}
                    <span className="min-w-0 max-w-[60%] flex-1 truncate text-xs font-medium text-gray-100">
                      {row.memberName || "Unassigned"}
                    </span>
                    <span className="min-w-0 shrink-0 truncate text-[11px] text-gray-400">
                      {row.slotLabel}
                    </span>
                  </div>
                  {canEdit && microphones.length > 0 ? (
                    <RadixSelect
                      value={selectValue}
                      disabled={savingSlot === slotKey}
                      onValueChange={(next) => {
                        onChange(
                          row,
                          next === NONE_MICROPHONE_VALUE ? [] : [next],
                        );
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={`Microphone for ${row.memberName || "Unassigned"} (${row.slotLabel})`}
                        className="mt-2 h-8 w-full justify-between border-gray-700 bg-gray-950/60 px-2 text-left text-[11px] text-gray-100"
                      >
                        <SelectValue placeholder="No microphone">
                          {selectedMicrophone ? (
                            <span className="inline-flex min-w-0 items-center gap-2">
                              <ServicePlanMicrophoneIcon
                                microphone={selectedMicrophone}
                                color={selectedMicrophone.color}
                                className="size-4 shrink-0"
                              />
                              <span className="truncate">
                                {selectedMicrophone.name}
                              </span>
                            </span>
                          ) : (
                            "No microphone"
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="min-w-[14rem]">
                        <SelectItem value={NONE_MICROPHONE_VALUE}>
                          No microphone
                        </SelectItem>
                        {microphones.map((microphone) => {
                          const assignedElsewhere = (
                            holdersByMicrophone.get(microphone.id) || []
                          )
                            .filter((holder) => holder.slotKey !== slotKey)
                            .map((holder) => holder.label);
                          const assignedLabel = assignedElsewhere.length
                            ? `Assigned: ${assignedElsewhere.join(", ")}`
                            : null;
                          return (
                            <SelectItem
                              key={microphone.id}
                              value={microphone.id}
                              textValue={microphone.name}
                            >
                              <span className="inline-flex min-w-0 flex-1 items-center gap-2">
                                <ServicePlanMicrophoneIcon
                                  microphone={microphone}
                                  color={microphone.color}
                                  className="size-4 shrink-0"
                                />
                                <span className="truncate">{microphone.name}</span>
                                {assignedLabel ? (
                                  <span className="ml-auto shrink-0 text-[10px] font-normal text-amber-300">
                                    {assignedLabel}
                                  </span>
                                ) : null}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </RadixSelect>
                  ) : row.microphoneIds.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {row.microphoneIds.map((microphoneId) => {
                        const microphone = microphoneById.get(microphoneId);
                        if (!microphone) return null;
                        return (
                          <ServicePlanMicrophoneChip
                            key={microphoneId}
                            microphone={microphone}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-gray-500">
                      No microphone assigned
                    </p>
                  )}
                  {sharedMicrophones.length ? (
                    <p className="mt-2 flex items-start gap-1 text-[11px] text-amber-300">
                      <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                      Shared with another scheduled role: {sharedMicrophones
                        .map((microphoneId) =>
                          microphoneById.get(microphoneId)?.name || "Microphone")
                        .join(", ")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
};

export default TeamMicrophonesPanel;
