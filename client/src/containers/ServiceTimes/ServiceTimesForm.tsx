import {
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Plus, SquarePen, X } from "lucide-react";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import FontSizeField from "../../components/FontSizeField/FontSizeField";
import Button from "../../components/Button/Button";
import ColorField from "../../components/ColorField/ColorField";
import {
  MonthWeekOrdinal,
  MultiWeeklyDay,
  RecurrenceType,
  ServiceTime,
  ServiceTimePosition,
  Weekday,
} from "../../types";
import Toggle from "../../components/Toggle/Toggle";
import TimePicker from "../../components/TimePicker/TimePicker";
import DateTimePicker from "@/components/ui/DateTimePicker";
import { ordinals, weekdays } from "./utils";
import { cn } from "@/utils/cnHelper";
import StreamPreview from "./StreamPreview";
import { ControllerInfoContext } from "../../context/controllerInfo";

const DEFAULT_COLOR = "#ffffff";
const DEFAULT_BG = "#000000a1";

type Props = {
  editingId: string | null;
  initialValues: ServiceTime | null;
  onSave: (values: Partial<ServiceTime>) => void;
  onCancel: () => void;
};

const ServiceTimesForm = ({ editingId, initialValues, onSave, onCancel }: Props) => {
  const { isMobile } = useContext(ControllerInfoContext) || {};

  // All form state lives here so typing doesn't re-render the parent
  const [name, setName] = useState(initialValues?.name ?? "");
  const [color, setColor] = useState(initialValues?.color ?? DEFAULT_COLOR);
  const [background, setBackground] = useState(initialValues?.background ?? DEFAULT_BG);
  const [recurrence, setRecurrence] = useState<RecurrenceType>(initialValues?.reccurence ?? "weekly");
  const [time, setTime] = useState(initialValues?.time ?? "10:00");
  const [dateTimeISO, setDateTimeISO] = useState(initialValues?.dateTimeISO ?? "");
  const [dayOfWeek, setDayOfWeek] = useState<Weekday>(initialValues?.dayOfWeek ?? 0);
  const [daysOfWeek, setDaysOfWeek] = useState<MultiWeeklyDay[]>(initialValues?.daysOfWeek ?? []);
  const [endDateISO, setEndDateISO] = useState(initialValues?.endDateISO ?? "");
  const [ordinal, setOrdinal] = useState<MonthWeekOrdinal>((initialValues?.ordinal as MonthWeekOrdinal) ?? 1);
  const [weekday, setWeekday] = useState<Weekday>(initialValues?.weekday ?? 3);
  const [nameSize, setNameSize] = useState(initialValues?.nameFontSize ?? 12);
  const [timeSize, setTimeSize] = useState(initialValues?.timeFontSize ?? 35);
  const [position, setPosition] = useState<ServiceTimePosition>(initialValues?.position ?? "top-right");
  const [shouldShowName, setShouldShowName] = useState(initialValues?.shouldShowName ?? true);

  // Re-initialize when the service being edited changes (not on every initialValues reference change)
  useEffect(() => {
    setName(initialValues?.name ?? "");
    setColor(initialValues?.color ?? DEFAULT_COLOR);
    setBackground(initialValues?.background ?? DEFAULT_BG);
    setRecurrence(initialValues?.reccurence ?? "weekly");
    setTime(initialValues?.time ?? "10:00");
    setDateTimeISO(initialValues?.dateTimeISO ?? "");
    setDayOfWeek(initialValues?.dayOfWeek ?? 0);
    setDaysOfWeek(initialValues?.daysOfWeek ?? []);
    setEndDateISO(initialValues?.endDateISO ?? "");
    setOrdinal((initialValues?.ordinal as MonthWeekOrdinal) ?? 1);
    setWeekday(initialValues?.weekday ?? 3);
    setNameSize(initialValues?.nameFontSize ?? 12);
    setTimeSize(initialValues?.timeFontSize ?? 35);
    setPosition(initialValues?.position ?? "top-right");
    setShouldShowName(initialValues?.shouldShowName ?? true);
    setPendingSetAllTime("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  // Defer name to StreamPreview so rapid typing doesn't block the input
  const deferredName = useDeferredValue(name);

  // Match preview column height to form column height on desktop
  const articleRef = useRef<HTMLElement | null>(null);
  const [previewMaxHeightPx, setPreviewMaxHeightPx] = useState<number | null>(null);

  const syncPreviewMaxHeight = useCallback(() => {
    const wide =
      typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
    const el = articleRef.current;
    if (!wide || !el) {
      setPreviewMaxHeightPx(null);
      return;
    }
    setPreviewMaxHeightPx(Math.ceil(el.getBoundingClientRect().height));
  }, []);

  useLayoutEffect(() => {
    syncPreviewMaxHeight();
    const mq =
      typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)") : null;
    const onMq = () => syncPreviewMaxHeight();
    mq?.addEventListener("change", onMq);
    const el = articleRef.current;
    const ro =
      el && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => syncPreviewMaxHeight())
        : null;
    if (el && ro) ro.observe(el);
    return () => {
      mq?.removeEventListener("change", onMq);
      if (ro && el) ro.disconnect();
    };
  }, [syncPreviewMaxHeight]);

  // Holds the user's intended time before any days are checked
  const [pendingSetAllTime, setPendingSetAllTime] = useState("");

  // True when all checked days share the same time — used by the "set all" control
  const allSameTime =
    daysOfWeek.length > 0 && daysOfWeek.every((d) => d.time === daysOfWeek[0].time);

  const canSave = useMemo(() => {
    if (!name) return false;
    if (recurrence === "one_time") return !!dateTimeISO;
    if (recurrence === "weekly") return time.length > 0;
    if (recurrence === "monthly") return time.length > 0;
    if (recurrence === "multi_weekly")
      return daysOfWeek.length > 0 && daysOfWeek.every((d) => d.time.length > 0);
    return false;
  }, [name, recurrence, dateTimeISO, time, daysOfWeek]);

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      name,
      color,
      background,
      reccurence: recurrence,
      time: recurrence !== "one_time" && recurrence !== "multi_weekly" ? time : undefined,
      dateTimeISO: recurrence === "one_time" ? dateTimeISO : undefined,
      dayOfWeek: recurrence === "weekly" ? dayOfWeek : undefined,
      daysOfWeek: recurrence === "multi_weekly" ? daysOfWeek : undefined,
      endDateISO: recurrence === "multi_weekly" ? endDateISO || undefined : undefined,
      ordinal: recurrence === "monthly" ? ordinal : undefined,
      weekday: recurrence === "monthly" ? weekday : undefined,
      position,
      nameFontSize: nameSize,
      timeFontSize: timeSize,
      shouldShowName,
      overrideDateTimeISO: undefined,
      updatedAt: new Date().toISOString(),
    });
  };

  const fieldClass = "min-w-0 w-full";
  const stackedFieldClass = "flex min-w-0 w-full flex-col gap-1";
  const labelClassName = "!p-0";

  return (
    <div className="flex w-full shrink-0 flex-col gap-4 md:flex-row md:items-stretch md:gap-6">
      <article
        ref={articleRef}
        className="w-full max-w-full shrink-0 self-start rounded-md border border-white/12 bg-black/30 p-4 md:w-fit md:max-w-lg"
      >
        <h2 className="text-xl font-semibold">
          {editingId ? "Edit Service Timer" : "Create Service Timer"}
        </h2>

        <section className="mt-4 grid min-w-0 grid-cols-2 gap-4">
          <Input
            className={stackedFieldClass}
            label="Name"
            labelClassName={labelClassName}
            value={name}
            onChange={(v) => setName(String(v))}
          />
          <Select
            className={stackedFieldClass}
            selectClassName="w-full"
            label="Type"
            labelClassName={labelClassName}
            value={recurrence}
            onChange={(v) => setRecurrence(v as RecurrenceType)}
            options={[
              { label: "One-time date", value: "one_time" },
              { label: "Weekly", value: "weekly" },
              { label: "Multi-day weekly", value: "multi_weekly" },
              { label: "Monthly", value: "monthly" },
            ]}
          />

          {recurrence === "one_time" && (
            <DateTimePicker
              className={stackedFieldClass}
              label="Date & Time"
              labelClassName={labelClassName}
              value={dateTimeISO}
              onChange={setDateTimeISO}
            />
          )}

          {recurrence === "weekly" && (
            <>
              <Select
                className={stackedFieldClass}
                selectClassName="w-full"
                label="Day"
                labelClassName={labelClassName}
                value={String(dayOfWeek)}
                onChange={(v) => setDayOfWeek(parseInt(v) as Weekday)}
                options={weekdays.map((d) => ({ label: d.label, value: String(d.value) }))}
              />
              <TimePicker
                variant="countdown"
                className={stackedFieldClass}
                inputClassName="min-w-0 w-full"
                label="Time"
                value={time}
                onChange={(v) => setTime(String(v))}
              />
            </>
          )}

          {recurrence === "multi_weekly" && (
            <>
              <div className={cn(stackedFieldClass, "col-span-2")}>
                <span className={cn("text-sm font-medium text-gray-300", labelClassName)}>
                  Days &amp; Times
                </span>
                <div className="mt-1 flex flex-col gap-1">
                  {/* Bulk-set control — always visible so a time can be chosen before selecting days */}
                  <div className="mb-1 flex items-center gap-3 border-b border-white/10 pb-2">
                    <span className="w-32 shrink-0 text-xs text-gray-400">Set all to</span>
                    <TimePicker
                      variant="countdown"
                      className="min-w-0 flex-1"
                      inputClassName="min-w-0 w-full"
                      value={
                        allSameTime
                          ? daysOfWeek[0].time
                          : daysOfWeek.length === 0
                            ? pendingSetAllTime
                            : ""
                      }
                      onChange={(v) => {
                        const t = String(v);
                        setPendingSetAllTime(t);
                        if (t) setDaysOfWeek(daysOfWeek.map((x) => ({ ...x, time: t })));
                      }}
                    />
                  </div>
                  {weekdays.map((d) => {
                    const entry = daysOfWeek.find((x) => x.day === d.value);
                    const checked = !!entry;
                    return (
                      <div key={d.value} className="flex items-center gap-3">
                        <label className="flex w-32 shrink-0 cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-cyan-400"
                            checked={checked}
                            onChange={() => {
                              if (checked) {
                                setDaysOfWeek(daysOfWeek.filter((x) => x.day !== d.value));
                              } else {
                                // Inherit the shared time when adding a new day so users
                                // don't have to re-enter the same time repeatedly
                                const defaultTime =
                                  allSameTime && daysOfWeek.length > 0
                                    ? daysOfWeek[0].time
                                    : pendingSetAllTime || "10:00";
                                setDaysOfWeek([
                                  ...daysOfWeek,
                                  { day: d.value, time: defaultTime },
                                ]);
                              }
                            }}
                          />
                          <span className="text-sm text-gray-200">{d.label}</span>
                        </label>
                        {/* Always rendered to prevent layout shift; hidden via visibility when unchecked */}
                        <div
                          className={cn(
                            "min-w-0 flex-1",
                            !checked && "invisible pointer-events-none",
                          )}
                        >
                          <TimePicker
                            variant="countdown"
                            className="min-w-0 w-full"
                            inputClassName="min-w-0 w-full"
                            value={entry?.time ?? "10:00"}
                            onChange={(v) => {
                              setDaysOfWeek(
                                daysOfWeek.map((x) =>
                                  x.day === d.value ? { ...x, time: String(v) } : x,
                                ),
                              );
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <Input
                className={stackedFieldClass}
                label="End Date (optional)"
                labelClassName={labelClassName}
                type="date"
                value={endDateISO}
                onChange={(v) => setEndDateISO(String(v))}
              />
            </>
          )}

          {recurrence === "monthly" && (
            <>
              <Select
                className={stackedFieldClass}
                selectClassName="w-full"
                label="Ordinal"
                labelClassName={labelClassName}
                value={String(ordinal)}
                onChange={(v) => setOrdinal(parseInt(v) as MonthWeekOrdinal)}
                options={ordinals.map((o) => ({ label: o.label, value: String(o.value) }))}
              />
              <Select
                className={stackedFieldClass}
                selectClassName="w-full"
                label="Weekday"
                labelClassName={labelClassName}
                value={String(weekday)}
                onChange={(v) => setWeekday(parseInt(v) as Weekday)}
                options={weekdays.map((d) => ({ label: d.label, value: String(d.value) }))}
              />
              <TimePicker
                variant="countdown"
                className={stackedFieldClass}
                inputClassName="min-w-0 w-full"
                label="Time"
                labelClassName={labelClassName}
                value={time}
                onChange={(v) => setTime(String(v))}
              />
            </>
          )}

          <ColorField className={fieldClass} label="Color" value={color} onChange={setColor} />
          <ColorField
            className={fieldClass}
            label="Background"
            value={background}
            onChange={setBackground}
          />

          <FontSizeField
            className={stackedFieldClass}
            label="Name Font Size"
            labelClassName={labelClassName}
            value={nameSize}
            onChange={setNameSize}
            min={5}
            max={40}
            defaultValue={12}
          />
          <FontSizeField
            className={stackedFieldClass}
            label="Timer Font Size"
            labelClassName={labelClassName}
            value={timeSize}
            onChange={setTimeSize}
            min={10}
            max={100}
            defaultValue={35}
          />
          <Select
            className={stackedFieldClass}
            selectClassName="w-full"
            label="Position"
            labelClassName={labelClassName}
            value={position}
            onChange={(v) => setPosition(v as ServiceTimePosition)}
            options={[
              { label: "Top Right", value: "top-right" },
              { label: "Top Left", value: "top-left" },
              { label: "Bottom Right", value: "bottom-right" },
              { label: "Bottom Left", value: "bottom-left" },
              { label: "Center", value: "center" },
            ]}
          />
          <Toggle
            layout="stacked"
            className={cn(stackedFieldClass, "items-start")}
            labelClassName={labelClassName}
            label="Show Name"
            value={shouldShowName}
            onChange={setShouldShowName}
          />
        </section>

        <section className="mt-4 flex w-full gap-2">
          <Button
            className="flex-1 justify-center"
            variant="secondary"
            svg={X}
            iconSize="sm"
            color="#22d3ee"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 justify-center"
            variant="primary"
            color="#22d3ee"
            svg={editingId ? SquarePen : Plus}
            iconSize="sm"
            onClick={handleSave}
            disabled={!canSave}
          >
            {editingId ? "Update" : "Add"}
          </Button>
        </section>
      </article>

      <StreamPreview
        name={deferredName}
        color={color}
        background={background}
        nameSize={nameSize}
        timeSize={timeSize}
        shouldShowName={shouldShowName}
        position={position}
        maxColumnHeightPx={isMobile ? null : previewMaxHeightPx}
      />
    </div>
  );
};

ServiceTimesForm.displayName = "ServiceTimesForm";
export default ServiceTimesForm;
