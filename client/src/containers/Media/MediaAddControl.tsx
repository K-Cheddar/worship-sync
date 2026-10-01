import type { ReactNode } from "react";
import { DropdownMenuItem } from "../../components/ui/DropdownMenu";
import Button from "../../components/Button/Button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "../../components/ui/Popover";
import { getTransferOverview, useOptionalTransfers } from "../../context/transferContext";

type MediaAddControlProps = {
  children: ReactNode;
  uploadProgress: { isUploading: boolean; progress: number };
  uploadTitle: string;
};

export const MediaAddControl = ({
  children,
  uploadProgress,
  uploadTitle,
}: MediaAddControlProps) => {
  const transferContext = useOptionalTransfers();
  const transfers = transferContext?.transfers ?? (uploadProgress.isUploading ? [{
    id: "media-upload",
    kind: "upload" as const,
    title: uploadTitle,
    status: "uploading" as const,
    progress: uploadProgress.progress,
    message: "Uploading media",
  }] : []);
  const overview = getTransferOverview(transfers);
  const percent = overview.progress === null ? null : Math.round(overview.progress);
  const showProgress = overview.activeCount > 0 && percent !== null && percent < 100;

  return (
    <div className="flex items-center gap-1">
      {children}
      {showProgress ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="tertiary"
              title="Show transfer summary"
              aria-label={`Show transfer summary: ${overview.activeCount} active transfers, ${percent}% overall`}
              className="gap-1"
              padding="px-1.5 py-1"
            >
              <span className="relative inline-flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="absolute inset-0 size-6">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.24" strokeWidth="2" />
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 9}
                    strokeDashoffset={2 * Math.PI * 9 * (1 - (overview.progress ?? 0) / 100)}
                    transform="rotate(-90 12 12)"
                    className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-300 motion-reduce:transition-none"
                  />
                </svg>
              </span>
              <span>{percent}%</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3">
            <h2 className="text-sm font-semibold">Transfers · {overview.activeCount} active · {percent}% overall</h2>
            <ul className="max-h-64 space-y-3 overflow-y-auto">
              {overview.transfers.map((transfer) => (
                <li key={transfer.id} className="min-w-0">
                  <p className="truncate text-sm font-medium">{transfer.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {transfer.type ? `${transfer.type} · ` : ""}{transfer.status} · {Math.round(transfer.progress)}%
                  </p>
                  <div
                    role="progressbar"
                    aria-label={`${transfer.name} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(transfer.progress)}
                    className="mt-1.5 h-1 overflow-hidden rounded bg-muted"
                  >
                    <div className="h-full rounded bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${transfer.progress}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <PopoverClose asChild>
              <Button variant="tertiary" className="w-full justify-center" onClick={transferContext?.restoreTransfers}>
                View all transfers
              </Button>
            </PopoverClose>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
};

export const ShowTransfersMenuItem = () => {
  const transfers = useOptionalTransfers();
  if (!transfers?.isMinimized || transfers.transfers.length === 0) return null;
  return <DropdownMenuItem onSelect={transfers.restoreTransfers}>Show transfers</DropdownMenuItem>;
};
