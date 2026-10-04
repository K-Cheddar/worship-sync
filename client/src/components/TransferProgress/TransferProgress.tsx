import { CheckCircle2, CircleAlert, LoaderCircle, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { normalizeProgress, type TransferOverviewItem } from "../../context/transferModel";

type TransferProgressProps = {
  transfer: TransferOverviewItem;
  variant: "card" | "summary" | "compact";
};

export const formatTransferProgress = (progressValue: number | null) => {
  const progress = normalizeProgress(progressValue);
  return progress === null ? "Working…" : `${Math.round(progress)}%`;
};

const statusLabel = (transfer: TransferOverviewItem) => {
  if (transfer.status === "queued") return "Queued";
  if (transfer.status === "complete") return "Complete";
  if (transfer.status === "failed") return "Failed";
  if (transfer.status === "cancelled") return "Cancelled";
  return transfer.phase?.label || "In progress";
};

const percentLabel = (transfer: TransferOverviewItem) => {
  return formatTransferProgress(transfer.progress);
};

export const TransferProgress = ({ transfer, variant }: TransferProgressProps) => {
  const compact = variant === "compact";
  const summary = variant === "summary";
  const progress = normalizeProgress(transfer.progress);
  const label = statusLabel(transfer);
  const phaseText = `${transfer.type ? `${transfer.type} · ` : ""}${label}${transfer.phase?.current !== undefined && transfer.phase.total !== undefined ? ` · ${transfer.phase.current} of ${transfer.phase.total}` : ""}`;
  const StatusIcon = transfer.status === "complete"
    ? CheckCircle2
    : transfer.status === "failed"
      ? CircleAlert
      : transfer.status === "cancelled"
        ? XCircle
        : LoaderCircle;

  return (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {!summary ? <StatusIcon size={compact ? 14 : 18} aria-hidden className="shrink-0 text-cyan-200" /> : null}
          <p className={compact ? "truncate text-xs font-medium" : "truncate text-sm font-medium"}>{transfer.name}</p>
        </div>
        <span className="shrink-0 text-xs text-gray-300" aria-label={`${label}${transfer.status === "active" ? `, ${percentLabel(transfer)}` : ""}`}>
          {transfer.status === "active" ? percentLabel(transfer) : label}
        </span>
      </div>
      <p className={`${compact ? "mt-0.5" : "mt-1"} truncate text-xs text-gray-300`}>
        {phaseText}
      </p>
      {transfer.detail ? <p className="mt-1 truncate text-xs text-gray-400">{transfer.detail}</p> : null}
      {transfer.status !== "failed" && transfer.status !== "cancelled" ? (
        <div
          role="progressbar"
          aria-label={`${transfer.name} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={progress === null ? `${label}, progress unknown` : `${Math.round(progress)}%`}
          {...(progress === null ? {} : { "aria-valuenow": Math.round(progress) })}
          className={`${compact ? "mt-1 h-1" : "mt-2 h-1.5"} overflow-hidden rounded bg-gray-700 motion-reduce:transition-none`}
        >
          {progress === null
            ? <div className="h-full w-1/3 animate-pulse rounded bg-cyan-500 motion-reduce:animate-none motion-reduce:w-full motion-reduce:opacity-60" />
            : <div className="h-full rounded bg-cyan-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} />}
        </div>
      ) : null}
      {transfer.error ? <p role="alert" className="mt-2 text-xs text-red-200">{transfer.error.message}</p> : null}
      {transfer.result ? (
        <div className="mt-2 text-xs">
          {transfer.result.to
          ? <Link to={transfer.result.to} className="flex cursor-pointer items-center gap-1 rounded text-cyan-200 underline outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-800">{transfer.result.label}</Link>
            : <span className="text-gray-300">{transfer.result.label}</span>}
        </div>
      ) : null}
    </div>
  );
};
