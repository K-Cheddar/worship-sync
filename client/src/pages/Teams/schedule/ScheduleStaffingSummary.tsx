import { CalendarDays, CheckCircle2, CircleAlert, Users } from "lucide-react";

type ScheduleStaffingSummaryProps = {
  serviceCount: number;
  filled: number;
  required: number;
  staffingStarted: boolean;
};

const ScheduleStaffingSummary = ({
  serviceCount,
  filled,
  required,
  staffingStarted,
}: ScheduleStaffingSummaryProps) => {
  if (serviceCount <= 0) return null;

  const hasStaffingRequirements = required > 0;
  const staffingIsComplete = staffingStarted && hasStaffingRequirements && filled === required;
  const positionsOpen = required - filled;
  const progress = staffingStarted && hasStaffingRequirements
    ? Math.round((filled / required) * 100)
    : null;

  return (
    <div
      role="status"
      aria-label="Schedule staffing summary"
      className="grid min-w-0 grid-cols-2 items-center gap-x-4 gap-y-2 sm:flex sm:flex-wrap sm:gap-x-5 sm:gap-y-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <CalendarDays className="size-4 shrink-0 text-cyan-300" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-lg font-semibold leading-tight text-gray-100">{serviceCount}</div>
          <div className="text-xs leading-tight text-gray-400">
            {serviceCount === 1 ? "Service" : "Services"}
          </div>
        </div>
      </div>

      {hasStaffingRequirements ? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            <Users className={`size-4 shrink-0 ${staffingIsComplete ? "text-emerald-300" : "text-gray-400"}`} aria-hidden="true" />
            <div className="min-w-0">
              <div className={`text-lg font-semibold leading-tight tabular-nums ${staffingIsComplete ? "text-emerald-300" : "text-gray-100"}`}>
                {staffingStarted ? `${filled} / ${required}` : "—"}
              </div>
              <div className="text-xs leading-tight text-gray-400">
                {staffingStarted ? "Positions filled" : "Staffing not started"}
              </div>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            {positionsOpen > 0 ? (
              <CircleAlert className="size-4 shrink-0 text-amber-300" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-300" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <div className={`text-lg font-semibold leading-tight tabular-nums ${positionsOpen > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                {staffingStarted ? positionsOpen : "—"}
              </div>
              <div className="text-xs leading-tight text-gray-400">
                {positionsOpen === 1 ? "Position open" : "Positions open"}
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="col-span-1 min-w-0 text-xs text-gray-400 sm:col-span-1">
          No positions required
        </p>
      )}

      {progress !== null ? (
        <div className="col-span-2 min-w-0 sm:col-span-1 sm:w-24">
          <div
            role="progressbar"
            aria-label="Staffing completion"
            aria-valuemin={0}
            aria-valuemax={required}
            aria-valuenow={filled}
            aria-valuetext={`${filled} of ${required} positions filled`}
            className="h-1.5 overflow-hidden rounded-full bg-gray-700"
          >
            <div
              className={`h-full rounded-full transition-[width] ${staffingIsComplete ? "bg-emerald-400" : "bg-amber-400"}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ScheduleStaffingSummary;
