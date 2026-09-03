import Button from "../../components/Button/Button";
import Menu from "../../components/Menu/Menu";
import TimeAdjuster from "./TimeAdjuster";
import { MonthWeekOrdinal, ServiceTime, Weekday, type MenuItemType } from "../../types";
import { formatOneTime, formatMonthly, formatMultiWeekly, formatWeekly } from "./utils";
import { MoreHorizontal, SquarePen, Timer } from "lucide-react";

type Props = {
  service?: ServiceTime;
  onEdit?: (id: string) => void;
  onToggleAdjust?: (id: string) => void;
  isAdjusting?: boolean;
};

const ServiceItem = ({
  service,
  onEdit,
  onToggleAdjust,
  isAdjusting = false,
}: Props) => {
  if (!service) return null;

  const menuItems: MenuItemType[] = [
    ...(onToggleAdjust
      ? [
          {
            element: (
              <span className="flex items-center gap-2">
                <Timer className="size-4" aria-hidden />
                {isAdjusting ? "Hide adjust" : "Adjust"}
              </span>
            ),
            onClick: () => onToggleAdjust(service.id),
          },
        ]
      : []),
    ...(onEdit
      ? [
          {
            element: (
              <span className="flex items-center gap-2">
                <SquarePen className="size-4" aria-hidden />
                Update
              </span>
            ),
            onClick: () => onEdit(service.id),
          },
        ]
      : []),
  ];
  return (
    <li
      className="flex min-w-0 flex-col overflow-hidden rounded-md border-y border-r border-l-4 border-white/10 bg-black/25"
      style={{ borderLeftColor: service.color }}
    >
      <div className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-gray-50">{service.name}</div>
          <div className="mt-1 text-sm leading-snug text-gray-400">
            {service.reccurence === "one_time" &&
              formatOneTime(service.dateTimeISO)}
            {service.reccurence === "weekly" &&
              formatWeekly(
                service.dayOfWeek,
                service.time,
                service.startDateISO,
                service.endDateISO,
              )}
            {service.reccurence === "monthly" &&
              formatMonthly(
                service.ordinal as MonthWeekOrdinal,
                service.weekday as Weekday,
                service.time,
                service.startDateISO,
                service.endDateISO,
              )}
            {service.reccurence === "multi_weekly" &&
              formatMultiWeekly(
                service.daysOfWeek,
                service.startDateISO,
                service.endDateISO,
              )}
          </div>
        </div>
        {menuItems.length > 0 ? (
          <div className="flex shrink-0 items-center justify-end">
            <Menu
              menuItems={menuItems}
              TriggeringButton={
                <Button
                  variant="tertiary"
                  svg={MoreHorizontal}
                  iconSize="sm"
                  aria-label="More service actions"
                  title="More service actions"
                />
              }
            />
          </div>
        ) : null}
      </div>
      {isAdjusting ? (
        <div className="border-t border-white/10 p-3">
          <TimeAdjuster serviceId={service.id} />
        </div>
      ) : null}
    </li>
  );
};

export default ServiceItem;
