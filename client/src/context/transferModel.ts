export type TransferStatus = "queued" | "active" | "complete" | "partial" | "failed" | "cancelled";

export type Transfer = {
  id: string;
  type: string;
  name: string;
  status: TransferStatus;
  /** Null means the producer cannot currently measure progress. */
  progress: number | null;
  phase?: {
    key: string;
    label: string;
    current?: number;
    total?: number;
  };
  detail?: string;
  result?: { label: string; to?: string };
  error?: { message: string };
  canCancel?: boolean;
  /** Warn before leaving while this producer has interruption-sensitive work. */
  blocksUnload?: boolean;
  actions?: Array<{
    key: string;
    label: string;
    pending?: boolean;
    confirmation?: { title: string; description: string; confirmLabel: string };
  }>;
};

export type TransferOverviewItem = Pick<Transfer, "id" | "name" | "type" | "status" | "progress" | "phase" | "detail" | "error" | "result">;

export const isActiveTransfer = (transfer: Transfer) =>
  transfer.status === "queued" || transfer.status === "active";

export const normalizeProgress = (progress: number | null) => {
  if (progress === null || !Number.isFinite(progress)) return null;
  return Math.max(0, Math.min(100, progress));
};

/**
 * Averages measurable active transfers. Indeterminate transfers remain in the
 * active count, but do not dilute the numeric mean; no measurable work means
 * the aggregate is indeterminate.
 */
export const getTransferOverview = (transfers: Transfer[]) => {
  const activeTransfers = transfers.filter(isActiveTransfer);
  const determinate = activeTransfers.flatMap((transfer) => {
    const progress = normalizeProgress(transfer.progress);
    return progress === null ? [] : [progress];
  });
  const progress = determinate.length
    ? determinate.reduce((sum, value) => sum + value, 0) / determinate.length
    : null;
  return {
    activeCount: activeTransfers.length,
    progress,
    transfers: activeTransfers as TransferOverviewItem[],
  };
};

export const getMediaTransferOverview = (transfers: Transfer[]) =>
  getTransferOverview(transfers.filter((transfer) => transfer.type === "Media upload"));
