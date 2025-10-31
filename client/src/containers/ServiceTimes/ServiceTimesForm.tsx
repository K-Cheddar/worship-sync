import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import Button from "../../components/Button/Button";
import ColorField from "../../components/ColorField/ColorField";
import {
  MonthWeekOrdinal,
  RecurrenceType,
  ServiceTimePosition,
  Weekday,
} from "../../types";
import Toggle from "../../components/Toggle/Toggle";
import { ordinals, weekdays } from "./utils";

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

const ServiceTimesForm = ({
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
}: Props) => {
  return (
    <article className="bg-gray-800 rounded p-4 w-fit">
      <h2 className="text-xl font-semibold">
        {editingId ? "Edit Service Timer" : "Create Service Timer"}
      </h2>
      <section className="grid grid-cols-2 gap-4">
        <Input
          className="flex flex-col gap-1 w-full"
          label="Name"
          value={name}
          onChange={(v) => setName(String(v))}
        />
        <Select
          className="w-full"
          selectClassName="w-full mt-1"
          label="Type"
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
            className="flex flex-col gap-1 w-full"
            label="Date & Time"
            type="datetime-local"
            value={dateTimeISO}
            onChange={(v) => setDateTimeISO(String(v))}
          />
        )}

        {recurrence === "weekly" && (
          <>
            <Select
              className="w-full"
              selectClassName="w-full mt-1"
              label="Day"
              value={String(dayOfWeek)}
              onChange={(v) => setDayOfWeek(parseInt(v) as Weekday)}
              options={weekdays.map((d) => ({
                label: d.label,
                value: String(d.value),
              }))}
            />
            <Input
              className="flex flex-col gap-1 w-full"
              label="Time"
              type="time"
              value={time}
              onChange={(v) => setTime(String(v))}
            />
          </>
        )}

        {recurrence === "monthly" && (
          <>
            <Select
              className="w-full flex"
              selectClassName="w-full mt-1"
              label="Ordinal"
              value={String(ordinal)}
              onChange={(v) => setOrdinal(parseInt(v) as MonthWeekOrdinal)}
              options={ordinals.map((o) => ({
                label: o.label,
                value: String(o.value),
              }))}
            />
            <Select
              className="w-full flex"
              selectClassName="w-full mt-1"
              label="Weekday"
              value={String(weekday)}
              onChange={(v) => setWeekday(parseInt(v) as Weekday)}
              options={weekdays.map((d) => ({
                label: d.label,
                value: String(d.value),
              }))}
            />
            <Input
              className="flex flex-col gap-1 w-full"
              label="Time"
              type="time"
              value={time}
              onChange={(v) => setTime(String(v))}
            />
          </>
        )}
      </section>

      <section className="grid grid-cols-2 gap-4 mt-4">
        <ColorField
          className="w-full"
          label="Color"
          value={color}
          onChange={setColor}
        />
        <ColorField
          className="w-full"
          label="Background"
          value={background}
          onChange={setBackground}
        />

        <Input
          className="flex flex-col gap-1"
          label="Name Font Size"
          type="number"
          value={String(nameSize)}
          onChange={(v) => setNameSize(parseInt(String(v) || "0", 10))}
        />
        <Input
          className="flex flex-col gap-1"
          label="Timer Font Size"
          type="number"
          value={String(timeSize)}
          onChange={(v) => setTimeSize(parseInt(String(v) || "0", 10))}
        />
        <Select
          className="w-full"
          selectClassName="w-full mt-1"
          label="Position"
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

        <div className="flex items-center gap-2">
          <Toggle
            label="Show Name"
            value={shouldShowName}
            onChange={setShouldShowName}
          />
        </div>

        <Button
          className="justify-center"
          variant="secondary"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          className="justify-center"
          variant="cta"
          onClick={onSave}
          disabled={!canSave}
        >
          {editingId ? "Update" : "Add"}
        </Button>
      </section>
    </article>
  );
};

export default ServiceTimesForm;
