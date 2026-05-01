import { forwardRef } from "react";
import { Plus, SquarePen, X } from "lucide-react";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import FontSizeField from "../../components/FontSizeField/FontSizeField";
import Button from "../../components/Button/Button";
import ColorField from "../../components/ColorField/ColorField";
import {
  MonthWeekOrdinal,
  RecurrenceType,
  ServiceTimePosition,
  Weekday,
} from "../../types";
import Toggle from "../../components/Toggle/Toggle";
import TimePicker from "../../components/TimePicker/TimePicker";
import { ordinals, weekdays } from "./utils";
import { cn } from "@/utils/cnHelper";

type Props = {
  editingId: string | null;
  name: string;
  setName: (v: string) => void;
  color: string;
  setColor: (v: string) => void;
  background: string;
  setBackground: (v: string) => void;
  recurrence: RecurrenceType;
  setRecurrence: (v: RecurrenceType) => void;
  time: string;
  setTime: (v: string) => void;
  dateTimeISO: string;
  setDateTimeISO: (v: string) => void;
  dayOfWeek: Weekday;
  setDayOfWeek: (v: Weekday) => void;
  ordinal: MonthWeekOrdinal;
  setOrdinal: (v: MonthWeekOrdinal) => void;
  weekday: Weekday;
  setWeekday: (v: Weekday) => void;
  nameSize: number;
  setNameSize: (v: number) => void;
  timeSize: number;
  setTimeSize: (v: number) => void;
  position: ServiceTimePosition;
  setPosition: (v: ServiceTimePosition) => void;
  shouldShowName: boolean;
  setShouldShowName: (v: boolean) => void;
  canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
};

const ServiceTimesForm = forwardRef<HTMLElement, Props>(({
  editingId,
  name,
  setName,
  color,
  setColor,
  background,
  setBackground,
  recurrence,
  setRecurrence,
  time,
  setTime,
  dateTimeISO,
  setDateTimeISO,
  dayOfWeek,
  setDayOfWeek,
  ordinal,
  setOrdinal,
  weekday,
  setWeekday,
  nameSize,
  setNameSize,
  timeSize,
  setTimeSize,
  position,
  setPosition,
  shouldShowName,
  setShouldShowName,
  canSave,
  onSave,
  onCancel,
}, ref) => {
  const fieldClass = "min-w-0 w-full";
  const stackedFieldClass = `flex min-w-0 w-full flex-col gap-1`;
  const labelClassName = "!p-0";

  return (
    <article ref={ref} className="w-full max-w-full shrink-0 self-start rounded-md border border-white/12 bg-black/30 p-4 md:w-fit md:max-w-lg">
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
            { label: "Monthly", value: "monthly" },
          ]}
        />

        {recurrence === "one_time" && (
          <Input
            className={stackedFieldClass}
            label="Date & Time"
            labelClassName={labelClassName}
            type="datetime-local"
            value={dateTimeISO}
            onChange={(v) => setDateTimeISO(String(v))}
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
              options={weekdays.map((d) => ({
                label: d.label,
                value: String(d.value),
              }))}
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

        {recurrence === "monthly" && (
          <>
            <Select
              className={stackedFieldClass}
              selectClassName="w-full"
              label="Ordinal"
              labelClassName={labelClassName}
              value={String(ordinal)}
              onChange={(v) => setOrdinal(parseInt(v) as MonthWeekOrdinal)}
              options={ordinals.map((o) => ({
                label: o.label,
                value: String(o.value),
              }))}
            />
            <Select
              className={stackedFieldClass}
              selectClassName="w-full"
              label="Weekday"
              labelClassName={labelClassName}
              value={String(weekday)}
              onChange={(v) => setWeekday(parseInt(v) as Weekday)}
              options={weekdays.map((d) => ({
                label: d.label,
                value: String(d.value),
              }))}
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

        <ColorField
          className={fieldClass}
          label="Color"
          value={color}
          onChange={setColor}
        />
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
          onClick={onSave}
          disabled={!canSave}
        >
          {editingId ? "Update" : "Add"}
        </Button>
      </section>
    </article>
  );
});

ServiceTimesForm.displayName = "ServiceTimesForm";
export default ServiceTimesForm;
