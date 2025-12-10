import Button from "../../components/Button/Button";
import { MonthWeekOrdinal, ServiceTime, Weekday } from "../../types";
import { formatOneTime, formatMonthly, formatWeekly } from "./utils";
import { ReactComponent as EditSVG } from "../../assets/icons/edit.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";

type Props = {
  service?: ServiceTime;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
};

const ServiceItem = ({ service, onEdit, onDelete }: Props) => {
  if (!service) return null;
  return (
    <li className="bg-gray-700 rounded p-3 flex items-center justify-between">
      <div>
        <div className="font-semibold flex items-center gap-2">
          {service.name}{" "}
          <span
            className="inline-block w-3 h-3 rounded-full"
            style={{ background: service.color }}
          />
        </div>
        <div className="text-sm text-gray-300">
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
      <div className="flex items-center gap-2">
        <Button
          variant="tertiary"
          svg={EditSVG}
          onClick={() => onEdit(service.id)}
          title="Edit"
        />
        <Button
          variant="tertiary"
          svg={DeleteSVG}
          color="#dc2626"
          onClick={() => onDelete(service.id)}
          title="Delete"
        />
      </div>
    </li>
  );
};

export default ServiceItem;
