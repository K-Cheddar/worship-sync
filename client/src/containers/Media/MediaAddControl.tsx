import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import Button from "../../components/Button/Button";
import { DropdownMenuItem } from "../../components/ui/DropdownMenu";
import { useOptionalTransfers, type TransferItem } from "../../context/transferContext";

type MediaAddControlProps = {
  children: ReactNode;
  uploadProgress: { isUploading: boolean; progress: number };
  uploadTitle: string;
  onUploadClick: () => void;
  disabled: boolean;
};

export const MediaAddControl = ({
  children,
  uploadProgress,
  uploadTitle,
  onUploadClick,
  disabled,
}: MediaAddControlProps) => {
  const transfers = useOptionalTransfers();
  const activeCanva = transfers?.transfers.find(
    (transfer): transfer is Extract<TransferItem, { kind: "canva" }> => transfer.kind === "canva" && !["completed", "partial", "failed", "cancelled"].includes(transfer.status),
  );

  if (activeCanva) {
    const completedPages = Object.values(activeCanva.pageStatus).filter((status) => status === "ready").length;
    const pagePercent = activeCanva.pages.length ? Math.floor(completedPages / activeCanva.pages.length * 100) : 0;
    const isPageProcessing = activeCanva.status === "finalizing" || Object.values(activeCanva.pageStatus).some((status) => ["processing", "saving", "ready", "error"].includes(status));
    const status = isPageProcessing
      ? `${completedPages} of ${activeCanva.pages.length} pages processed · ${pagePercent}%`
      : activeCanva.status === "exporting"
        ? "Requesting Canva export…"
        : "Preparing Canva import…";
    return (
      <Button
        variant="tertiary"
        svg={Plus}
        title={status}
        aria-label={`Show transfer progress: ${status}`}
        onClick={transfers?.restoreTransfers}
        disabled={disabled}
      >
        {isPageProcessing ? `${pagePercent}%` : "…"}
      </Button>
    );
  }

  if (uploadProgress.isUploading) {
    return (
      <Button
        variant="tertiary"
        svg={Plus}
        title={uploadTitle}
        aria-label="Show upload progress"
        onClick={onUploadClick}
        disabled={disabled}
      >
        {`${Math.round(uploadProgress.progress)}%`}
      </Button>
    );
  }

  return <>{children}</>;
};

export const ShowTransfersMenuItem = () => {
  const transfers = useOptionalTransfers();
  if (!transfers?.isMinimized || transfers.transfers.length === 0) return null;
  return <DropdownMenuItem onSelect={transfers.restoreTransfers}>Show transfers</DropdownMenuItem>;
};
