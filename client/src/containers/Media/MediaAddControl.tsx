import type { ReactNode } from "react";
import { DropdownMenuItem } from "../../components/ui/DropdownMenu";
import Button from "../../components/Button/Button";
import { useOptionalTransfers } from "../../context/transferContext";
import { getTransferOverview } from "../../context/transferContext";

type MediaAddControlProps = {
  children: ReactNode;
};

export const MediaAddControl = ({ children }: MediaAddControlProps) => {
  const transferContext = useOptionalTransfers();
  const transfers = transferContext?.transfers ?? [];
  const activeCount = getTransferOverview(transfers).activeCount;
  const showActivity = transfers.length > 0;

  return (
    <div className="flex items-center gap-1">
      {children}
      {showActivity ? (
        <Button
          variant="tertiary"
          title="Show Activity"
          aria-label={`Show Activity: ${activeCount} active`}
          onClick={transferContext?.restoreTransfers}
          className="gap-1"
          padding="px-1.5 py-1"
        >
          Activity · {activeCount} active
        </Button>
      ) : null}
    </div>
  );
};

export const ShowTransfersMenuItem = () => {
  const transfers = useOptionalTransfers();
  if (!transfers?.isMinimized || transfers.transfers.length === 0) return null;
  return <DropdownMenuItem onSelect={transfers.restoreTransfers}>Show Activity</DropdownMenuItem>;
};
