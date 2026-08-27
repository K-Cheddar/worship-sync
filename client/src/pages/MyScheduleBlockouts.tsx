import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { CalendarOff, ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import Button from "../components/Button/Button";
import Icon from "../components/Icon/Icon";
import BlockoutDatesField from "./Teams/components/BlockoutDatesField";
import { findBlockoutRangeForDate } from "./Teams/teamsUtils";
import { updateMyBlockoutDates, type MyScheduleOccurrence } from "../api/auth";
import type { TeamBlockoutDateRange, TeamRosterMember } from "../api/authTypes";
import { getApiErrorStatus, showApiErrorToast } from "../utils/apiErrorToast";
import { useToast } from "../context/toastContext";

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

type MyScheduleBlockoutsProps = {
  churchId: string;
  blockoutDates: TeamBlockoutDateRange[];
  /** `updatedAt` of the record this edit started from; the write precondition. */
  expectedUpdatedAt: string;
  /** Used to spot dates the member is already scheduled for. */
  occurrences: MyScheduleOccurrence[];
  onSaved: (member: TeamRosterMember) => void;
  /** Lets the page skip a background refresh while an edit is open. */
  onDirtyChange: (dirty: boolean) => void;
  /** Called when the record moved underneath this edit, to pick up the change. */
  onStale: () => void;
};

type BlockoutConflict = {
  occurrenceId: string;
  label: string;
};

/** Local calendar date as YYYY-MM-DD; en-CA is ISO-like and stable. */
const todayPlainDate = () => new Date().toLocaleDateString("en-CA");

const formatConflictWhen = (occurrence: MyScheduleOccurrence): string => {
  const parsed = new Date(occurrence.startsAt);
  if (Number.isNaN(parsed.getTime())) return occurrence.date;
  return parsed.toLocaleDateString(undefined, {
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
const partitionByEnded = (ranges: TeamBlockoutDateRange[]) => {
  const today = todayPlainDate();
  return {
    ended: ranges.filter((range) => hasEnded(range, today)),
    current: ranges.filter((range) => !hasEnded(range, today)),
  };
};

/** Value identity for a range list, for comparing a draft against a baseline. */
const signRanges = (ranges: TeamBlockoutDateRange[]) => JSON.stringify(ranges);

const MyScheduleBlockouts = ({
  churchId,
  blockoutDates,
  expectedUpdatedAt,
  occurrences,
  onSaved,
  onDirtyChange,
  onStale,
}: MyScheduleBlockoutsProps) => {
  const { showToast } = useToast();
  const conflictHeadingId = useId();
  const [open, setOpen] = useState(false);
  const { ended, current } = useMemo(
    () => partitionByEnded(blockoutDates),
    [blockoutDates],
  );
  const [draft, setDraft] = useState<TeamBlockoutDateRange[]>(current);
  const [saving, setSaving] = useState(false);
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
  const [baseline, setBaseline] = useState(() => signRanges(current));

  const seedDraft = useCallback((ranges: TeamBlockoutDateRange[]) => {
    setDraft(ranges);
    setBaseline(signRanges(ranges));
    setFieldKey((key) => key + 1);
  }, []);

  /**
   * Services the member is on that fall inside a drafted blockout. Computed
   * from the draft rather than what is saved, so the clash shows while they are
   * still picking dates instead of only after the fact.
   */
  const conflicts = useMemo<BlockoutConflict[]>(() => {
    const today = todayPlainDate();
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
        label: `${occurrence.name || "Service"} · ${formatConflictWhen(occurrence)}`,
      }));
  }, [draft, occurrences]);

  const draftSignature = signRanges(draft);
  const currentSignature = signRanges(current);
  const isDirty = draftSignature !== baseline;

  /**
   * Adopt server state that arrived while this editor was mounted — a
   * background refresh, or the pull after a 409 — but only when the reader has
   * nothing in flight. With an edit open the draft wins and the conflict is
   * theirs to resolve on save; without one, silently keeping the old snapshot
   * is how stale dates get written back.
   */
  useEffect(() => {
    if (currentSignature === baseline) return;
    if (draftSignature !== baseline) return;
    seedDraft(current);
  }, [baseline, current, currentSignature, draftSignature, seedDraft]);

  // Reported up so a background refresh cannot replace an open edit. Cleared on
  // unmount, or leaving the list view would pin the page as permanently dirty.
  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);

  const discard = () => seedDraft(current);

  const save = async () => {
    setSaving(true);
    try {
      // Entries hidden from the editor are sent back untouched. Editing what is
      // actionable must not amount to deleting the rest.
      const result = await updateMyBlockoutDates(
        churchId,
        [...ended, ...draft],
        expectedUpdatedAt,
      );
      const saved = result.member?.blockoutDates || [];
      // Re-seed from the server so its normalization is what stays on screen: a
      // single day collapsed to one date, a blank row dropped, history past the
      // retention window pruned. Seeding also moves the baseline, so the save
      // leaves the editor clean rather than looking edited again.
      seedDraft(partitionByEnded(saved).current);
      onSaved(result.member);
      showToast("Time off saved.", "success");
    } catch (error) {
      // 409: the record moved under this edit. Pull the change in so the reader
      // is comparing against what is actually stored, but keep their draft —
      // discarding an edit to report a conflict trades one loss for another.
      if (getApiErrorStatus(error) === 409) onStale();
      showApiErrorToast(showToast, error, "Could not save your time off.");
    } finally {
      setSaving(false);
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

          <BlockoutDatesField
            key={fieldKey}
            variant="admin"
            showNotes
            emptyLabel="No upcoming dates added yet."
            value={draft}
            onChange={setDraft}
          />

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
              disabled={!isDirty || saving}
              onClick={discard}
            >
              Discard changes
            </Button>
            <Button
              type="button"
              variant="cta"
              className="max-md:min-h-0"
              disabled={!isDirty || saving}
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
