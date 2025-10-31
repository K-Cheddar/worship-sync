import Button from "../../components/Button/Button";
import { MonthWeekOrdinal, ServiceTime, Weekday } from "../../types";
import { formatOneTime, formatMonthly, formatWeekly } from "./utils";
import { ReactComponent as EditSVG } from "../../assets/icons/edit.svg";
import { ReactComponent as DeleteSVG } from "../../assets/icons/delete.svg";

type Props = {
  services: ServiceTime[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
};

const ServiceTimesList = ({ services, onEdit, onDelete }: Props) => {
  return (
    <section className="bg-gray-800 rounded p-4 flex flex-col gap-2 flex-1 min-h-0">
      <h2 className="text-xl font-semibold">Service Times</h2>
      {services.length === 0 ? (
        <p className="text-gray-300">No service times yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto flex-1 h">
          {services.map((s) => (
            <li
              key={s.id}
              className="bg-gray-700 rounded p-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span
                  className="inline-block w-3 h-3 rounded"
                  style={{ background: s.color }}
                />
                <div>
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-sm text-gray-300">
                    {s.reccurence === "one_time" &&
                      formatOneTime(s.dateTimeISO)}
                    {s.reccurence === "weekly" &&
                      formatWeekly(s.dayOfWeek, s.time)}
                    {s.reccurence === "monthly" &&
                      formatMonthly(
                        s.ordinal as MonthWeekOrdinal,
                        s.weekday as Weekday,
                        s.time
                      )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="tertiary"
                  svg={EditSVG}
                  onClick={() => onEdit(s.id)}
                  title="Edit"
                />
                <Button
                  variant="tertiary"
                  svg={DeleteSVG}
                  color="#dc2626"
                  onClick={() => onDelete(s.id)}
                  title="Delete"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default ServiceTimesList;
