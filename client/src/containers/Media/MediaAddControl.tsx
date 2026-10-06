import { useEffect, type ReactNode } from "react";
import { Activity, CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { DropdownMenuItem } from "../../components/ui/DropdownMenu";
import Button from "../../components/Button/Button";
import { useOptionalTransfers } from "../../context/transferContext";
import { getActivitySummary, type Transfer } from "../../context/transferModel";

type MediaAddControlProps = {
  children: ReactNode;
};

const getActivityIcon = (transfers: Transfer[]) => {
  const summary = getActivitySummary(transfers);
  if (summary.attentionCount) return CircleAlert;
  if (summary.activeCount) return LoaderCircle;
  if (transfers.every((transfer) => transfer.status === "complete")) return CircleCheck;
  return Activity;
};

export const MediaAddControl = ({ children }: MediaAddControlProps) => {
  const transferContext = useOptionalTransfers();
  const transfers = transferContext?.transfers ?? [];
  const summary = getActivitySummary(transfers);
  const showActivity = transfers.length > 0;
  const registerActivityHost = transferContext?.registerActivityHost;

  useEffect(() => {
    if (!registerActivityHost) return;
    return registerActivityHost();
  }, [registerActivityHost]);

  const activityAccent = summary.accent === "attention"
    ? "text-amber-300"
    : summary.accent === "active" ? "text-cyan-300" : "text-gray-400";
  const ActivityIcon = getActivityIcon(transfers);
  const activityIconMotion = summary.activeCount ? "animate-spin motion-reduce:animate-none" : "";

  return (
    <div className="flex min-w-0 items-center gap-1">
      {children}
      {showActivity ? (
        <Button
          variant="tertiary"
          title={`Show ${summary.label}`}
          aria-label={`Show ${summary.label}`}
          onClick={transferContext?.restoreTransfers}
          className="min-w-0 gap-1"
          padding="px-1.5 py-1"
        >
          <ActivityIcon size={16} aria-hidden data-testid="activity-icon" className={`shrink-0 ${activityAccent} ${activityIconMotion}`} />
          <span className="block min-w-0 max-w-40 truncate @max-[300px]/sources-actions:max-w-16 @max-[240px]/sources-actions:hidden">{summary.label}</span>
        </Button>
      ) : null}
    </div>
  );
};

export const ShowTransfersMenuItem = () => {
  const transfers = useOptionalTransfers();
  if (!transfers?.isMinimized || transfers.transfers.length === 0) return null;
  const summary = getActivitySummary(transfers.transfers);
  const activityAccent = summary.accent === "attention"
    ? "text-amber-300"
    : summary.accent === "active" ? "text-cyan-300" : "text-gray-400";
  return <DropdownMenuItem onSelect={transfers.restoreTransfers}><Activity size={16} aria-hidden data-testid="activity-menu-icon" className={activityAccent} />Show Activity</DropdownMenuItem>;
};
