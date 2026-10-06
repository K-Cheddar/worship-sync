import { useEffect, type ReactNode } from "react";
import { Activity } from "lucide-react";
import { DropdownMenuItem } from "../../components/ui/DropdownMenu";
import Button from "../../components/Button/Button";
import { useOptionalTransfers } from "../../context/transferContext";
import { getActivitySummary } from "../../context/transferModel";

type MediaAddControlProps = {
  children: ReactNode;
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

  return (
    <div className="flex items-center gap-1">
      {children}
      {showActivity ? (
        <Button
          variant="tertiary"
          title="Show Activity"
          aria-label={`Show ${summary.label}`}
          onClick={transferContext?.restoreTransfers}
          className="gap-1"
          padding="px-1.5 py-1"
        >
          <Activity size={16} aria-hidden data-testid="activity-icon" className={activityAccent} />
          {summary.label}
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
