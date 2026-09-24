import { useState } from "react";
import { ChevronDown } from "lucide-react";
import Button from "../Button/Button";
import AnimateCollapse from "../AnimateCollapse/AnimateCollapse";
import type { ChurchStorageQuota, ChurchStorageQuotaUsage } from "../../api/authTypes";
import {
  formatStorageBytes,
  formatStorageMinutes,
  getQuotaProgress,
  getQuotaRemainingLabel,
} from "./storageUsageFormatting";

export type StorageUsageProvider = "r2" | "cloudinary" | "mux";

type StorageUsageIndicatorsProps = {
  status: "loading" | "error" | "ready";
  quotas?: ChurchStorageQuotaUsage;
  providers: StorageUsageProvider[];
  onRetry: () => void;
  className?: string;
};

const providerLabels: Record<StorageUsageProvider, string> = {
  r2: "File storage",
  cloudinary: "Image storage (Cloudinary)",
  mux: "Video storage (Mux)",
};

const formatAmount = (quota: ChurchStorageQuota) =>
  quota.unit === "minutes"
    ? formatStorageMinutes(quota.used)
    : formatStorageBytes(quota.used);

const formatLimit = (quota: ChurchStorageQuota) =>
  quota.unit === "minutes"
    ? formatStorageMinutes(quota.limit)
    : formatStorageBytes(quota.limit);

const formatRemaining = (quota: ChurchStorageQuota) => {
  const status = getQuotaRemainingLabel(quota.used, quota.limit);
  if (status) return status;
  const remaining = quota.limit - quota.used;
  return quota.unit === "minutes"
    ? `${formatStorageMinutes(remaining)} remaining`
    : `${formatStorageBytes(remaining)} remaining`;
};

const UsageIndicator = ({
  provider,
  quota,
}: {
  provider: StorageUsageProvider;
  quota: ChurchStorageQuota;
}) => {
  const progress = getQuotaProgress(quota.used, quota.limit);
  const full = quota.used >= quota.limit;
  const barColor = full
    ? "bg-red-500"
    : progress >= 80
      ? "bg-amber-400"
      : "bg-cyan-400";
  const statusColor = full
    ? "text-red-300"
    : progress >= 80
      ? "text-amber-200"
      : "text-gray-400";

  return (
    <section className="min-w-0 rounded border border-gray-700 bg-gray-950/40 px-3 py-2" aria-label={providerLabels[provider]}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs">
        <h3 className="font-medium text-gray-200">{providerLabels[provider]}</h3>
        <span className="text-gray-300">
          {formatAmount(quota)} / {formatLimit(quota)}
        </span>
      </div>
      <p className={`mt-0.5 text-xs ${statusColor}`}>{formatRemaining(quota)}</p>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-700"
        role="progressbar"
        aria-label={`${providerLabels[provider]} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${progress}%` }} />
      </div>
    </section>
  );
};

export const StorageUsageIndicators = ({
  status,
  quotas,
  providers,
  onRetry,
  className = "",
}: StorageUsageIndicatorsProps) => {
  const [expanded, setExpanded] = useState(false);
  const header = (
    <div className="flex min-h-8 items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto whitespace-nowrap">
        <h3 className="shrink-0 text-xs font-medium text-gray-200">Storage usage</h3>
        {status === "ready" && quotas && providers.map((provider) => (
          <span key={provider} className="shrink-0 text-xs text-gray-300">
            {providerLabels[provider]}: {formatAmount(quotas[provider])} / {formatLimit(quotas[provider])}
          </span>
        ))}
      </div>
      <Button
        type="button"
        variant="tertiary"
        padding="p-0.5"
        className="min-h-0 shrink-0 rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200"
        aria-expanded={expanded}
        aria-label={expanded ? "Hide storage usage details" : "Show storage usage details"}
        onClick={() => setExpanded((current) => !current)}
      >
        <ChevronDown className={`size-5 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </Button>
    </div>
  );

  if (status === "loading") {
    return (
      <div className={`min-w-0 ${className}`}>
        {header}
        <AnimateCollapse open={expanded}>
          <div role="group" aria-label="Storage usage" aria-busy="true" className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            {providers.map((provider) => (
              <section key={provider} className="min-w-0 rounded border border-gray-700 bg-gray-950/40 px-3 py-2" aria-label={`${providerLabels[provider]} loading`}>
                <div className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
                  <h3 className="font-medium text-gray-200">{providerLabels[provider]}</h3>
                  <span className="h-3 w-24 animate-pulse rounded bg-gray-700" aria-hidden />
                </div>
                <div className="mt-1.5 h-3 w-28 animate-pulse rounded bg-gray-800" aria-hidden />
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-700" aria-hidden>
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-gray-500" />
                </div>
              </section>
            ))}
            <span className="sr-only" aria-live="polite">Loading storage usage...</span>
          </div>
        </AnimateCollapse>
      </div>
    );
  }
  if (status === "error" || !quotas) {
    return (
      <div className={`min-w-0 ${className}`}>
        {header}
        <AnimateCollapse open={expanded}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300" role="alert">
            <span>Storage usage unavailable</span>
            <Button type="button" variant="tertiary" className="min-h-0 px-2 py-1 text-xs" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </AnimateCollapse>
      </div>
    );
  }

  return (
    <div className={`min-w-0 ${className}`}>
      {header}
      <AnimateCollapse open={expanded}>
        <div role="group" aria-label="Storage usage" className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          {providers.map((provider) => (
            <UsageIndicator key={provider} provider={provider} quota={quotas[provider]} />
          ))}
        </div>
      </AnimateCollapse>
    </div>
  );
};
