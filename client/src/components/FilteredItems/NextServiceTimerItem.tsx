import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import Button from "../Button/Button";
import { cn } from "../../utils/cnHelper";
import { ServiceTime } from "../../types";
import useNextServiceCountdownText from "../../hooks/useNextServiceCountdownText";

type NextServiceTimerItemProps = {
  upcomingService: { service: ServiceTime; nextAt: Date };
  onAdd: () => void;
};

const NextServiceTimerItem = ({
  upcomingService,
  onAdd,
}: NextServiceTimerItemProps) => {
  const [justAdded, setJustAdded] = useState(false);

  const targetIso = useMemo(() => {
    return upcomingService.nextAt.toISOString();
  }, [upcomingService]);

  const countdownText = useNextServiceCountdownText(targetIso);

  const handleAdd = () => {
    onAdd();
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 2000);
  };

  return (
    <div
      role="listitem"
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border transition-colors",
        "border-gray-500/40 bg-gray-950/30 hover:border-gray-400/60",
      )}
    >
      <div className="flex flex-col gap-2 py-1.5 pl-4 pr-4 md:flex-row md:items-center md:gap-2">
        <div className="flex w-full min-w-0 items-start justify-between gap-2 md:flex-1 md:justify-start md:pr-0">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide bg-violet-800 text-white-100">
                Upcoming
              </span>
              <span className="text-white truncate">
                {upcomingService.service.name || "Upcoming Service"}
              </span>
              {countdownText != null && (
                <span className="tabular-nums text-violet-300">{countdownText}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:ml-auto md:flex-nowrap">
          <Button
            variant="primary"
            color={justAdded ? "#84cc16" : "#22d3ee"}
            className="min-h-6 text-sm leading-3"
            padding="py-1 px-2"
            disabled={justAdded}
            svg={justAdded ? Check : Plus}
            onClick={handleAdd}
          >
            {justAdded ? "Added." : "Add to outline"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NextServiceTimerItem;
