import { useEffect, useMemo, useState } from "react";
import Button from "../../../components/Button/Button";
import Select from "../../../components/Select/Select";
import {
  AuthApiError,
  getTeamRosterMemberServiceAvailability,
  updateTeamRosterMemberServiceAvailability,
} from "../../../api/auth";
import type {
  TeamRosterMember,
  TeamSchedule,
  TeamScheduleSummary,
  TeamService,
} from "../../../api/authTypes";
import type { ServiceAvailabilityOccurrence } from "./serviceAvailabilityEditorModel";
import {
  formatServiceAvailabilityDate,
  formatServiceAvailabilityMonthRange,
  formatServiceAvailabilityTime,
  getServiceAvailabilityMonthRange,
  getServiceAvailabilityValue,
  getUpcomingServiceAvailabilityOccurrences,
  groupServiceAvailabilityByDate,
  type ServiceAvailabilityStatus,
} from "./serviceAvailabilityEditorModel";

type PendingAvailabilityChange = {
  occurrence: ServiceAvailabilityOccurrence;
  status: ServiceAvailabilityStatus;
  removeOccurrenceIds: string[];
};

type MemberServiceAvailabilityEditorProps = {
  churchId: string;
  member: TeamRosterMember;
  services: TeamService[];
  schedules: Array<TeamSchedule | TeamScheduleSummary>;
  timeZone: string;
  timeZoneStatus: "loading" | "ready" | "error";
  disabled: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  onSaved: (member: TeamRosterMember) => void;
};

const availabilityOptions = [
  { label: "Not set", value: "not_set" },
  { label: "Available", value: "available" },
  { label: "Unavailable", value: "unavailable" },
];

const statusLabel = (status: ServiceAvailabilityStatus) => {
  if (status === "available") return "Available";
  if (status === "unavailable") return "Unavailable";
  return "Not set";
};

const MemberServiceAvailabilityEditor = ({
  churchId,
  member,
  services,
  schedules,
  timeZone,
  timeZoneStatus,
  disabled,
  onDirtyChange,
  onSavingChange,
  onSaved,
}: MemberServiceAvailabilityEditorProps) => {
  const [monthOffset, setMonthOffset] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Record<string, PendingAvailabilityChange>>({});
  const [reviewedAvailability, setReviewedAvailability] = useState<{
    serviceAvailability: TeamRosterMember["serviceAvailability"];
    updatedAt: string;
  } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const range = useMemo(() => timeZone
    ? getServiceAvailabilityMonthRange(new Date(), timeZone, monthOffset)
    : { startDate: "", endDate: "" }, [monthOffset, timeZone]);
  const occurrences = useMemo(() => getUpcomingServiceAvailabilityOccurrences({
    services,
    schedules,
    range,
    timeZone,
  }), [range, schedules, services, timeZone]);
  const groupedOccurrences = useMemo(
    () => groupServiceAvailabilityByDate(occurrences),
    [occurrences],
  );
  const currentAvailability = reviewedAvailability?.serviceAvailability ?? member.serviceAvailability;
  const availabilityRevision = reviewedAvailability?.updatedAt ?? member.updatedAt ?? "";

  useEffect(() => {
    setReviewedAvailability(null);
    setConflict(false);
    setError("");
  }, [member.updatedAt]);

  useEffect(() => {
    onDirtyChange?.(Object.keys(pendingChanges).length > 0);
  }, [onDirtyChange, pendingChanges]);

  const changeStatus = (
    occurrence: ServiceAvailabilityOccurrence,
    statusValue: string,
  ) => {
    const status = statusValue === "available" || statusValue === "unavailable"
      ? statusValue
      : null;
    const baseline = getServiceAvailabilityValue(
      occurrence,
      currentAvailability,
      timeZone,
    );
    const nextRemoveIds = baseline.occurrenceIds.filter(
      (id) => id !== occurrence.occurrenceId,
    );
    if (status === baseline.status && !baseline.hasConflictingValues) {
      setPendingChanges((current) => {
        const next = { ...current };
        delete next[occurrence.occurrenceId];
        return next;
      });
      return;
    }
    setPendingChanges((current) => ({
      ...current,
      [occurrence.occurrenceId]: {
        occurrence,
        status,
        removeOccurrenceIds: status === null
          ? [...new Set([...baseline.occurrenceIds, occurrence.occurrenceId])]
          : nextRemoveIds,
      },
    }));
    setError("");
  };

  const refreshAndReview = async () => {
    if (refreshing || saving) return;
    setRefreshing(true);
    setError("");
    try {
      const response = await getTeamRosterMemberServiceAvailability(
        churchId,
        member.memberId,
      );
      setReviewedAvailability({
        serviceAvailability: response.serviceAvailability || {},
        updatedAt: response.updatedAt || "",
      });
      setConflict(true);
    } catch {
      setError("Could not refresh availability. Try again.");
    } finally {
      setRefreshing(false);
    }
  };

  const saveChanges = async () => {
    const changes = Object.values(pendingChanges);
    if (disabled || saving || changes.length === 0) return;
    onSavingChange?.(true);
    setSaving(true);
    setError("");
    try {
      const response = await updateTeamRosterMemberServiceAvailability(
        churchId,
        member.memberId,
        {
          expectedUpdatedAt: availabilityRevision,
          changes: changes.map(({ occurrence, status, removeOccurrenceIds }) => ({
            occurrenceId: occurrence.occurrenceId,
            logicalOccurrenceId: occurrence.logicalOccurrenceId,
            serviceId: occurrence.serviceId,
            serviceIds: occurrence.serviceIds?.length
              ? occurrence.serviceIds
              : [occurrence.serviceId],
            ...(occurrence.groupId ? { groupId: occurrence.groupId } : {}),
            serviceDate: occurrence.serviceDate,
            startsAt: occurrence.startsAt,
            status,
            removeOccurrenceIds,
          })),
        },
      );
      const savedMember: TeamRosterMember = {
        ...member,
        serviceAvailability: response.serviceAvailability || {},
        updatedAt: response.updatedAt || member.updatedAt,
      };
      onSaved(savedMember);
      setPendingChanges({});
      setReviewedAvailability({
        serviceAvailability: savedMember.serviceAvailability,
        updatedAt: savedMember.updatedAt || "",
      });
      setConflict(false);
    } catch (saveError) {
      if (saveError instanceof AuthApiError && saveError.status === 409) {
        setConflict(true);
        setError("This member changed elsewhere. Refresh and review the latest availability before saving again.");
      } else {
        setError("Could not save availability. Your changes are still here.");
      }
    } finally {
      setSaving(false);
      onSavingChange?.(false);
    }
  };

  const discardChanges = () => {
    setPendingChanges({});
    setConflict(false);
    setReviewedAvailability(null);
    setError("");
  };

  return (
    <details
      className="rounded-md border border-gray-700 bg-gray-950/40 p-3"
      onToggle={(event) => setIsExpanded(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-semibold text-gray-100">
        Service availability
      </summary>
      {isExpanded ? <div className="mt-3 space-y-3">
        <p className="text-xs text-gray-400">
          Not set leaves availability unspecified; it doesn’t mark this person unavailable.
        </p>
        {timeZoneStatus === "loading" ? (
          <p className="text-sm text-gray-300" role="status">Loading the church time zone…</p>
        ) : timeZoneStatus === "error" ? (
          <p className="text-sm text-amber-200" role="alert">
            Could not load the church time zone. Refresh Teams to try again.
          </p>
        ) : !timeZone ? (
          <p className="text-sm text-amber-200" role="status">
            Set a church time zone in Service setup to view service availability.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-200" aria-live="polite">
                {formatServiceAvailabilityMonthRange(range)}
              </p>
              <div className="flex gap-2">
                {monthOffset > 0 ? (
                  <Button
                    type="button"
                    variant="tertiary"
                    padding="px-2 py-1"
                    disabled={saving || refreshing}
                    onClick={() => setMonthOffset((current) => Math.max(0, current - 2))}
                  >
                    Earlier
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="tertiary"
                  padding="px-2 py-1"
                  disabled={saving || refreshing}
                  onClick={() => setMonthOffset((current) => current + 2)}
                >
                  Later
                </Button>
              </div>
            </div>
            {groupedOccurrences.length === 0 ? (
              <p className="rounded-md border border-gray-800 px-3 py-2 text-sm text-gray-400">
                No upcoming services in these months.
              </p>
            ) : (
              <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {groupedOccurrences.map(({ date, services: dateServices }) => (
                  <section key={date} aria-label={formatServiceAvailabilityDate(dateServices[0], timeZone)}>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      {formatServiceAvailabilityDate(dateServices[0], timeZone)}
                    </h3>
                    <ul className="space-y-1">
                      {dateServices.map((occurrence) => {
                        const pending = pendingChanges[occurrence.occurrenceId];
                        const savedValue = getServiceAvailabilityValue(
                          occurrence,
                          currentAvailability,
                          timeZone,
                        );
                        const selectedStatus = pending
                          ? pending.status
                          : savedValue.status;
                        const accessibleName = `Availability for ${occurrence.name}, ${formatServiceAvailabilityDate(occurrence, timeZone)} at ${formatServiceAvailabilityTime(occurrence, timeZone)}`;
                        const savedNow = conflict && reviewedAvailability && pending
                          ? getServiceAvailabilityValue(
                              occurrence,
                              reviewedAvailability?.serviceAvailability,
                              timeZone,
                            )
                          : null;
                        return (
                          <li
                            key={occurrence.occurrenceId}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-800 px-2 py-1.5"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-gray-100">
                                {occurrence.name}
                                <span className="ml-2 text-xs text-gray-400">
                                  {formatServiceAvailabilityTime(occurrence, timeZone)}
                                </span>
                              </p>
                              {savedValue.hasConflictingValues ? (
                                <p className="text-xs text-amber-200">
                                  Saved responses differ. Choose a status to resolve them.
                                </p>
                              ) : null}
                              {savedNow && savedNow.status !== pending.status ? (
                                <p className="text-xs text-amber-200">
                                  Saved now: {statusLabel(savedNow.status)}. Your edit: {statusLabel(pending.status)}.
                                </p>
                              ) : null}
                            </div>
                            <Select
                              aria-label={accessibleName}
                              value={selectedStatus === null ? "not_set" : selectedStatus}
                              options={availabilityOptions}
                              size="sm"
                              disabled={disabled || saving || refreshing}
                              onChange={(value) => changeStatus(occurrence, value)}
                              className="w-36 shrink-0"
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </>
        )}

        {error ? <p className="text-sm text-amber-200" role="alert">{error}</p> : null}
        {conflict ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={refreshing || saving}
              onClick={() => void refreshAndReview()}
            >
              {refreshing ? "Refreshing…" : "Refresh and review"}
            </Button>
            {reviewedAvailability ? (
              <span className="text-xs text-gray-400" role="status">
                Latest saved values are loaded. Your edits are still here.
              </span>
            ) : null}
          </div>
        ) : null}
        {Object.keys(pendingChanges).length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-800 pt-3">
            <Button
              type="button"
              variant="primary"
              disabled={disabled || saving || refreshing || !timeZone}
              onClick={() => void saveChanges()}
            >
              {saving ? "Saving availability…" : "Save availability"}
            </Button>
            <Button
              type="button"
              variant="tertiary"
              disabled={saving || refreshing}
              onClick={discardChanges}
            >
              Discard availability changes
            </Button>
          </div>
        ) : null}
      </div> : null}
    </details>
  );
};

export default MemberServiceAvailabilityEditor;
