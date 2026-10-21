import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarOff, ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import Button from "../components/Button/Button";
import Icon from "../components/Icon/Icon";
import BlockoutDatesField from "./Teams/components/BlockoutDatesField";
import { findBlockoutRangeForDate, formatBlockoutDateRangeLabel } from "./Teams/teamsUtils";
import { updateMyBlockoutDates, type MyScheduleOccurrence } from "../api/auth";
import type { TeamBlockoutDateRange } from "../api/authTypes";
import { getApiErrorStatus, showApiErrorToast } from "../utils/apiErrorToast";
import { useToast } from "../context/toastContext";
import { calendarDateInTimeZone } from "../utils/teamScheduleOccurrences";
import type { MyScheduleMember, MyScheduleOperations } from "./myScheduleOperations";

/**
 * A volunteer's own time off, on the one Teams surface they can reach.
 *
 * Until now blockout dates could only be set on an intake form or by an admin
 * editing the roster, so a member who booked a trip had no way to say so. The
 * write is self-scoped server-side and touches `blockoutDates` only — this is
 * not a back door into the roster.
 *
 * Collapsed by default: the schedule is what people come here for. Conflicts
 * stay visible in the collapsed header, since a clash is the one thing worth
 * interrupting for.
 */

export type SavedDatesLoadState =
  | { status: "pending" | "ready" }
  | { status: "failed"; accessMessage?: string };

type MyScheduleBlockoutsProps = {
  churchId: string;
  serviceTimeZone: string;
  blockoutDates: TeamBlockoutDateRange[];
  /** Latest saved revision. A dirty draft retains its own baseline revision. */
  expectedUpdatedAt: string;
  /** Used to spot dates the member is already scheduled for. */
  occurrences: MyScheduleOccurrence[];
  onSaved: (member: MyScheduleMember) => void;
  saveBlockouts?: MyScheduleOperations["saveBlockouts"];
  /** Lets the page skip a background refresh while an edit is open. */
  onDirtyChange: (dirty: boolean) => void;
  /** Called when the record moved underneath this edit, to pick up the change. */
  onStale: () => Promise<boolean> | undefined;
  savedDatesLoad: SavedDatesLoadState;
};

type BlockoutConflict = {
  occurrenceId: string;
  label: string;
};

const formatConflictWhen = (occurrence: MyScheduleOccurrence, timeZone: string): string => {
  const parsed = new Date(occurrence.startsAt);
  if (Number.isNaN(parsed.getTime())) return occurrence.date;
  return parsed.toLocaleDateString(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

const summarizeEntries = (count: number) => {
  if (count === 0) return "None added";
  return `${count} upcoming`;
};

const hasEnded = (range: TeamBlockoutDateRange, today: string) =>
  (range.endDate || range.startDate) < today;

/**
 * Split off trips that are already over. They are still stored — the server
 * keeps a year of history — but editing them is pointless, and a volunteer of
 * several years would otherwise scroll past dozens of dead entries to reach
 * next summer.
 */
const partitionByEnded = (ranges: TeamBlockoutDateRange[], timeZone: string) => {
  const today = calendarDateInTimeZone(new Date(), timeZone);
  return {
    ended: ranges.filter((range) => hasEnded(range, today)),
    current: ranges.filter((range) => !hasEnded(range, today)),
  };
};

/** Value identity for a range list, for comparing a draft against a baseline. */
const signRanges = (ranges: TeamBlockoutDateRange[]) => JSON.stringify(ranges);

const MyScheduleBlockouts = ({
  churchId,
  serviceTimeZone,
  blockoutDates,
  expectedUpdatedAt,
  occurrences,
  onSaved,
  onDirtyChange,
  onStale,
  savedDatesLoad,
  saveBlockouts,
}: MyScheduleBlockoutsProps) => {
  const { showToast } = useToast();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const conflictHeadingId = useId();
  const [open, setOpen] = useState(false);
  const { current } = useMemo(
    () => partitionByEnded(blockoutDates, serviceTimeZone),
    [blockoutDates, serviceTimeZone],
  );
  const [showEnded, setShowEnded] = useState(false);
  const [draft, setDraft] = useState<TeamBlockoutDateRange[]>(blockoutDates);
  const { ended: draftEnded, current: draftCurrent } = useMemo(
    () => partitionByEnded(draft, serviceTimeZone),
    [draft, serviceTimeZone],
  );
  const editorRanges = showEnded ? draft : draftCurrent;
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [rejectedAsStale, setRejectedAsStale] = useState(false);
  const refreshing = savedDatesLoad.status === "pending";
  // BlockoutDatesField seeds its rows from `value` once, so re-seeding needs a
  // remount rather than a prop change.
  const [fieldKey, setFieldKey] = useState(0);
  /**
   * What `draft` was last seeded from — *not* the latest props.
   *
   * Dirty has to mean "the reader changed something", not "the draft differs
   * from the server". A background refresh moves the props underneath a mounted
   * editor; measuring against those would invent an edit nobody made, and
   * saving it would push the older dates back over the newer ones with a
   * freshly refreshed write stamp the server has no reason to reject.
   */
  const [baseline, setBaseline] = useState(() => ({
    ranges: blockoutDates, updatedAt: expectedUpdatedAt,
  }));

  const seedDraft = useCallback((ranges: TeamBlockoutDateRange[], updatedAt: string) => {
    setDraft(ranges);
    setBaseline({ ranges, updatedAt });
    setRejectedAsStale(false);
    setFieldKey((key) => key + 1);
  }, []);

  /**
   * Services the member is on that fall inside a drafted blockout. Computed
   * from the draft rather than what is saved, so the clash shows while they are
   * still picking dates instead of only after the fact.
   */
  const conflicts = useMemo<BlockoutConflict[]>(() => {
    const today = calendarDateInTimeZone(new Date(), serviceTimeZone);
    return occurrences
      .filter((occurrence) => occurrence.date >= today)
      .filter((occurrence) =>
        occurrence.serving.some((person) => person.isMe),
      )
      .filter((occurrence) =>
        Boolean(findBlockoutRangeForDate(draft, occurrence.date)),
      )
      .map((occurrence) => ({
        occurrenceId: occurrence.occurrenceId,
        label: `${occurrence.name || "Service"} · ${formatConflictWhen(occurrence, serviceTimeZone)}`,
      }));
  }, [draft, occurrences, serviceTimeZone]);

  const draftSignature = signRanges(draft);
  const serverSignature = signRanges(blockoutDates);
  const baselineSignature = signRanges(baseline.ranges);
  const isDirty = draftSignature !== baselineSignature;
  const hasConflict = rejectedAsStale || (isDirty && expectedUpdatedAt !== baseline.updatedAt);
  // A successful HTTP response alone cannot recover a rejected baseline.
  const savedRevisionTime = Date.parse(expectedUpdatedAt);
  const baselineRevisionTime = Date.parse(baseline.updatedAt);
  const revisionAdvanced = Number.isFinite(savedRevisionTime) && Number.isFinite(baselineRevisionTime)
    ? savedRevisionTime > baselineRevisionTime
    : Boolean(expectedUpdatedAt) && expectedUpdatedAt !== baseline.updatedAt;
  const canReviewSavedDates = savedDatesLoad.status === "ready" && revisionAdvanced;
  const refreshLabel = canReviewSavedDates ? "Refresh saved dates" : "Retry loading saved dates";

  /**
   * Adopt server state that arrived while this editor was mounted — a
   * background refresh, or the pull after a 409 — but only when the reader has
   * nothing in flight. With an edit open the draft wins and the conflict is
   * theirs to resolve on save; without one, silently keeping the old snapshot
   * is how stale dates get written back.
   */
  useEffect(() => {
    if (saving || rejectedAsStale || isDirty) return;
    if (serverSignature === baselineSignature && expectedUpdatedAt === baseline.updatedAt) return;
    seedDraft(blockoutDates, expectedUpdatedAt);
  }, [baseline.updatedAt, baselineSignature, blockoutDates, expectedUpdatedAt, isDirty, rejectedAsStale, saving, seedDraft, serverSignature]);

  // Reported up so a background refresh cannot replace an open edit. Cleared on
  // unmount, or leaving the list view would pin the page as permanently dirty.
  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);

  const discard = () => {
    if (saving || refreshing || (hasConflict && !canReviewSavedDates)) return;
    seedDraft(blockoutDates, expectedUpdatedAt);
  };

  const handleDraftChange = (next: TeamBlockoutDateRange[]) => {
    // When past dates are hidden, preserve them in the draft while applying
    // edits only to the entries shown in the field.
    setDraft(showEnded ? next : [...draftEnded, ...next]);
  };

  const refreshSavedDates = () => {
    if (refreshing) return;
    void onStale();
  };

  const save = async () => {
    if (savingRef.current || hasConflict) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Entries hidden from the editor are sent back untouched. Editing what is
      // actionable must not amount to deleting the rest.
      const result = await (saveBlockouts
        ? saveBlockouts(draft, baseline.updatedAt)
        : updateMyBlockoutDates(churchId, draft, baseline.updatedAt));
      if (!mounted.current) return;
      const saved = result.member?.blockoutDates || [];
      // Re-seed from the server so its normalization is what stays on screen: a
      // single day collapsed to one date, a blank row dropped, history past the
      // retention window pruned. Seeding also moves the baseline, so the save
      // leaves the editor clean rather than looking edited again.
      seedDraft(saved, result.member.updatedAt || "");
      onSaved(result.member);
      showToast("Time off saved.", "success");
    } catch (error) {
      if (!mounted.current) return;
      // 409: the record moved under this edit. Pull the change in so the reader
      // is comparing against what is actually stored, but keep their draft —
      // discarding an edit to report a conflict trades one loss for another.
      if (getApiErrorStatus(error) === 409) {
        setRejectedAsStale(true);
        void refreshSavedDates();
      }
      showApiErrorToast(showToast, error, "Could not save your time off.");
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-700/80 bg-gray-900/40">
      <Button
        type="button"
        variant="tertiary"
        aria-expanded={open}
        className="h-auto w-full items-center justify-between gap-3 px-3 py-2 font-normal max-md:min-h-0"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon svg={CalendarOff} size="sm" className="shrink-0 text-orange-300" />
          <span className="text-sm font-semibold text-gray-100">Time off</span>
          <span className="truncate text-xs text-gray-400">
            {summarizeEntries(current.length)}
          </span>
          {conflicts.length > 0 ? (
            <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-300">
              <Icon svg={TriangleAlert} size="xs" />
              {conflicts.length === 1
                ? "1 conflict"
                : `${conflicts.length} conflicts`}
            </span>
          ) : null}
        </span>
        <Icon
          svg={open ? ChevronUp : ChevronDown}
          size="sm"
          className="shrink-0 text-gray-400"
        />
      </Button>

      {open ? (
        <div className="space-y-3 border-t border-gray-800 px-3 py-3">
          <p className="text-xs text-gray-400">
            Add the dates you are away. Your team leads see these when they build
            the schedule.
          </p>

          {hasConflict ? <div role="alert" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
            <p>Your saved information changed elsewhere. Your unsaved dates are kept.</p>
            {refreshing ? <p>Loading saved dates. Your unsaved dates are still here.</p> : null}
            {!refreshing && !canReviewSavedDates ? <p>
              Your unsaved dates are still here, but we couldn't load the latest saved dates. Try refreshing before deciding what to keep.
            </p> : null}
            {savedDatesLoad.status === "failed" && savedDatesLoad.accessMessage ? <p>{savedDatesLoad.accessMessage}</p> : null}
            {canReviewSavedDates ? <>
              <p>Review the saved dates, then discard your draft and reapply any changes you still need.</p>
              <details>
                <summary className="cursor-pointer underline">Review saved dates</summary>
                {blockoutDates.length ? <ul className="mt-2 space-y-1">
                  {blockoutDates.map((range, index) => <li key={index}>
                    {formatBlockoutDateRangeLabel(range)}{range.notes ? ` · ${range.notes}` : ""}
                  </li>)}
                </ul> : <p className="mt-2">No saved dates.</p>}
              </details>
            </> : null}
            <Button type="button" variant="tertiary" disabled={refreshing} onClick={() => void refreshSavedDates()}>
              {refreshing ? "Refreshing saved dates…" : refreshLabel}
            </Button>
          </div> : null}

          <fieldset disabled={saving}>
            <BlockoutDatesField
              key={`${fieldKey}-${showEnded ? "all" : "current"}`}
              variant="admin"
              showNotes
              emptyLabel="No upcoming dates added yet."
              value={editorRanges}
              onChange={handleDraftChange}
            />
          </fieldset>

          {draftEnded.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-gray-500">
                {showEnded
                  ? "Past dates are shown for reference."
                  : `${draftEnded.length} past ${draftEnded.length === 1 ? "date is" : "dates are"} hidden.`}
              </p>
              <Button
                type="button"
                variant="tertiary"
                aria-expanded={showEnded}
                className="h-auto min-h-0 px-0 py-0 text-xs text-gray-400 underline underline-offset-2 hover:text-gray-200"
                onClick={() => setShowEnded((current) => !current)}
              >
                {showEnded
                  ? "Hide past dates"
                  : `Show ${draftEnded.length} past ${draftEnded.length === 1 ? "date" : "dates"}`}
              </Button>
            </div>
          ) : null}

          {conflicts.length > 0 ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <p
                id={conflictHeadingId}
                className="flex items-center gap-1.5 text-sm font-medium text-amber-200"
              >
                <Icon svg={TriangleAlert} size="sm" />
                You are scheduled on some of these dates
              </p>
              <ul
                aria-labelledby={conflictHeadingId}
                className="mt-1.5 space-y-0.5 text-sm text-amber-100/90"
              >
                {conflicts.map((conflict) => (
                  <li key={conflict.occurrenceId}>{conflict.label}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-amber-200/80">
                You can still save. Your team lead sees the conflict on the
                schedule and can fill the slot another way.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="tertiary"
              className="max-md:min-h-0"
              disabled={(!isDirty && !hasConflict) || saving || refreshing || (hasConflict && !canReviewSavedDates)}
              onClick={discard}
            >
              Discard changes
            </Button>
            <Button
              type="button"
              variant="cta"
              className="max-md:min-h-0"
              disabled={!isDirty || saving || hasConflict}
              onClick={save}
            >
              {saving ? "Saving…" : "Save time off"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
};

export default MyScheduleBlockouts;
