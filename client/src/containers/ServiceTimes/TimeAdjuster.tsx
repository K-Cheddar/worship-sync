import { useId, useMemo, useState } from "react";
import { useDispatch, useSelector } from "../../hooks";
import { RootState } from "../../store/store";
import { updateService } from "../../store/serviceTimesSlice";
import { getEffectiveTargetTime } from "../../utils/serviceTimes";
import generateRandomId from "../../utils/generateRandomId";
import { Plus, RotateCcw, Timer, X } from "lucide-react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";

type Props = {
  serviceId: string;
};

type MinuteSecondField = number | "";

type SumChip = {
  id: string;
  seconds: number;
};

const toFieldNumber = (v: MinuteSecondField) => (v === "" ? 0 : v);

const formatMmSs = (totalSeconds: number) => {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

const TimeAdjuster = ({ serviceId }: Props) => {
  const headingId = useId();
  const dispatch = useDispatch();
  const services = useSelector(
    (s: RootState) => s.undoable.present.serviceTimes.list
  );
  const service = services.find((s) => s.id === serviceId);
  const [minutes, setMinutes] = useState<MinuteSecondField>("");
  const [seconds, setSeconds] = useState<MinuteSecondField>("");
  const [sumChips, setSumChips] = useState<SumChip[]>([]);

  const hasScheduleOverride = useMemo(
    () => Boolean(service?.overrideDateTimeISO),
    [service?.overrideDateTimeISO]
  );

  const resetToScheduledTime = () => {
    if (!service || !hasScheduleOverride) return;
    dispatch(
      updateService({
        id: serviceId,
        changes: { overrideDateTimeISO: undefined },
      })
    );
  };

  const adjustTime = (deltaSeconds: number) => {
    if (!service) return;

    const currentNext = getEffectiveTargetTime(service);
    if (!currentNext) return;

    const newOverrideTime = new Date(
      currentNext.getTime() + deltaSeconds * 1000
    ).toISOString();

    dispatch(
      updateService({
        id: serviceId,
        changes: { overrideDateTimeISO: newOverrideTime },
      })
    );
  };

  const clampValue = (value: number, min: number, max: number): number => {
    return Math.max(min, Math.min(max, value));
  };

  const handleMinutesBlur = () => {
    if (minutes === "") return;
    setMinutes(clampValue(minutes, 0, 59));
  };

  const handleSecondsBlur = () => {
    if (seconds === "") return;
    setSeconds(clampValue(seconds, 0, 59));
  };

  const applySecondsToCountdown = (totalSeconds: number) => {
    if (!service || totalSeconds <= 0) return;

    const now = new Date();
    const newTime = new Date(now.getTime() + totalSeconds * 1000);

    dispatch(
      updateService({
        id: serviceId,
        changes: { overrideDateTimeISO: newTime.toISOString() },
      })
    );
  };

  const setExactTime = () => {
    const totalSeconds = toFieldNumber(minutes) * 60 + toFieldNumber(seconds);
    if (totalSeconds <= 0) return;
    applySecondsToCountdown(totalSeconds);
    setMinutes("");
    setSeconds("");
  };

  const addToSum = () => {
    const totalSeconds = toFieldNumber(minutes) * 60 + toFieldNumber(seconds);
    if (totalSeconds <= 0) return;
    setSumChips((prev) => [
      ...prev,
      { id: generateRandomId(), seconds: totalSeconds },
    ]);
    setMinutes("");
    setSeconds("");
  };

  const removeSumChip = (id: string) => {
    setSumChips((prev) => prev.filter((c) => c.id !== id));
  };

  const applySumToCountdown = () => {
    const total = sumSeconds;
    if (total <= 0) return;
    applySecondsToCountdown(total);
    setSumChips([]);
  };

  const sumSeconds = useMemo(
    () => sumChips.reduce((acc, c) => acc + c.seconds, 0),
    [sumChips]
  );

  const canSetExact =
    toFieldNumber(minutes) > 0 || toFieldNumber(seconds) > 0;

  const entrySeconds =
    toFieldNumber(minutes) * 60 + toFieldNumber(seconds);

  const onMinuteSecondChange = (
    val: string | number,
    setter: (v: MinuteSecondField) => void
  ) => {
    if (val === "") {
      setter("");
      return;
    }
    const n = typeof val === "number" ? val : Number(val);
    if (!Number.isFinite(n)) return;
    setter(n);
  };

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="rounded-md border border-white/10 bg-black/20 p-3"
    >
      <div className="mb-3">
        <h4
          id={headingId}
          className="text-sm font-semibold tracking-tight text-gray-100"
        >
          Adjust countdown
        </h4>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-stretch md:gap-x-4 md:gap-y-2">
        <div className="flex w-fit flex-col gap-3">
          <div className="flex w-full flex-col gap-3 rounded-md border border-white/10 bg-black/30 p-3">
            <p className="text-xs leading-relaxed text-gray-400">
              One- or five-minute steps.
            </p>
            <div className="flex flex-wrap items-center gap-1">
              <Button variant="tertiary" className="flex-1" onClick={() => adjustTime(-300)}>
                -5 min
              </Button>
              <Button variant="tertiary" className="flex-1" onClick={() => adjustTime(-60)}>
                -1 min
              </Button>
              <Button variant="tertiary" className="flex-1" onClick={() => adjustTime(60)}>
                +1 min
              </Button>
              <Button variant="tertiary" className="flex-1" onClick={() => adjustTime(300)}>
                +5 min
              </Button>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 rounded-md border border-white/10 bg-black/30 p-3">
            <p className="text-xs leading-relaxed text-gray-400">
              Restore the scheduled start and clear manual changes.
            </p>
            <Button
              variant="secondary"
              onClick={resetToScheduledTime}
              disabled={!hasScheduleOverride}
              svg={RotateCcw}
              color="#22d3ee"
              className="w-full justify-center"
              title={
                hasScheduleOverride
                  ? "Use the next scheduled start time (clear adjustments)"
                  : "No manual adjustments to clear — countdown already follows the schedule"
              }
            >
              Reset to scheduled time
            </Button>
          </div>
        </div>

        <div
          className="flex min-w-0 flex-1 flex-col gap-3 border-t border-white/10 pt-4 md:border-t-0 md:border-l md:border-white/20 md:pt-0 md:pl-4"
          aria-label="Set exact remaining time and quick sum"
        >
          <div className="flex min-w-0 w-full max-w-full flex-1 flex-col gap-3 rounded-md border border-white/10 bg-black/30 p-3 md:w-fit">
            <p className="text-xs leading-relaxed text-gray-400">
              Minutes and seconds, then set remaining time or add to sum.
            </p>
            <div className="flex min-w-0 flex-col gap-2 md:flex-row md:flex-wrap md:items-end md:gap-2">
              <div className="flex min-w-0 w-full gap-2 md:w-auto md:shrink-0 items-center justify-center">
                <Input
                  type="number"
                  min={0}
                  max={59}
                  placeholder="0-59"
                  value={minutes}
                  onChange={(val) => onMinuteSecondChange(val, setMinutes)}
                  onBlur={handleMinutesBlur}
                  inputWidth="w-22 md:w-14"
                  className="m-0 min-w-0"
                  label="Minutes"
                  labelStyle="compactLight"
                />
                <Input
                  type="number"
                  min={0}
                  max={59}
                  placeholder="0-59"
                  value={seconds}
                  onChange={(val) => onMinuteSecondChange(val, setSeconds)}
                  onBlur={handleSecondsBlur}
                  inputWidth="w-22 md:w-14"
                  className="m-0 min-w-0"
                  label="Seconds"
                  labelStyle="compactLight"
                />
              </div>
              <div className="flex min-w-0 w-full gap-2 md:flex-1 md:justify-between">
                <Button
                  onClick={addToSum}
                  variant="secondary"
                  disabled={!canSetExact}
                  svg={Plus}
                  color="#22d3ee"
                  className="min-h-0 min-w-0 flex-1 justify-center md:flex-none"
                >
                  Add {formatMmSs(entrySeconds)} to sum
                </Button>
                <Button
                  onClick={setExactTime}
                  variant="primary"
                  disabled={!canSetExact}
                  svg={Timer}
                  color="#22d3ee"
                  className="min-h-0 min-w-0 flex-1 justify-center md:flex-none"
                >
                  Set to {formatMmSs(entrySeconds)}
                </Button>
              </div>
            </div>

            <div className="h-px bg-white/10" aria-hidden />
            <p className="text-xs leading-relaxed text-gray-400">
              Set the countdown to the total when you're ready.
            </p>
            {sumChips.length > 0 ? (
              <>
                <p
                  className="font-mono text-sm tabular-nums tracking-tight text-gray-100"
                  aria-live="polite"
                >
                  {sumChips.map((c) => formatMmSs(c.seconds)).join(" + ")} ={" "}
                  {formatMmSs(sumSeconds)}
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {sumChips.map((c) => (
                    <span
                      key={c.id}
                      className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.07] py-0.5 pl-2.5 pr-1 text-xs font-medium text-gray-100"
                    >
                      <span className="tabular-nums">
                        {formatMmSs(c.seconds)}
                      </span>
                      <button
                        type="button"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100"
                        aria-label={`Remove ${formatMmSs(c.seconds)} from sum`}
                        onClick={() => removeSumChip(c.id)}
                      >
                        <X className="h-3 w-3" strokeWidth={2.5} />
                      </button>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-500">No segments in sum yet.</p>
            )}
            <Button
              onClick={applySumToCountdown}
              variant="primary"
              disabled={sumChips.length === 0 || sumSeconds <= 0}
              svg={Timer}
              color="#22d3ee"
              className="w-fit"
            >
              Set Countdown to {formatMmSs(sumSeconds)}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimeAdjuster;
