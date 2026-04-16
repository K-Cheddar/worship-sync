import Button from "../../components/Button/Button";
import { MonthWeekOrdinal, ServiceTime, Weekday } from "../../types";
import { formatOneTime, formatMonthly, formatWeekly } from "./utils";
import { SquarePen, Trash2 } from "lucide-react";

type Props = {
  service?: ServiceTime;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
};

const ServiceItem = ({ service, onEdit, onDelete }: Props) => {
  if (!service) return null;
  return (
    <li
      className="flex min-w-0 overflow-hidden rounded-md border-y border-r border-l-4 border-white/10 bg-black/25"
      style={{ borderLeftColor: service.color }}
    >
      <div className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-gray-50">{service.name}</div>
          <div className="mt-1 text-sm leading-snug text-gray-400">
            {service.reccurence === "one_time" &&
              formatOneTime(service.dateTimeISO)}
            {service.reccurence === "weekly" &&
              formatWeekly(service.dayOfWeek, service.time)}
            {service.reccurence === "monthly" &&
              formatMonthly(
                service.ordinal as MonthWeekOrdinal,
                service.weekday as Weekday,
                service.time
              )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button
            variant="secondary"
            svg={SquarePen}
            iconSize="sm"
            onClick={() => onEdit(service.id)}
          >
            Update
          </Button>
          <Button
            variant="destructive"
            svg={Trash2}
            iconSize="sm"
            onClick={() => onDelete(service.id)}
          >
            Delete
          </Button>
        </div>
      </div>
    </li>
  );
};

export default ServiceItem;
