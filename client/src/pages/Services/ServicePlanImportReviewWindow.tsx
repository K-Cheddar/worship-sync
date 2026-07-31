import FloatingWindow from "../../components/FloatingWindow/FloatingWindow";
import Button from "../../components/Button/Button";
import { cn } from "../../utils/cnHelper";
import { Check } from "lucide-react";
import type {
  ServicePlanImportChangeKind,
  ServicePlanImportSummary,
} from "./servicePlanImportSummary";

type ServicePlanImportReviewWindowProps = {
  summary: ServicePlanImportSummary;
  onApply: () => void;
  onClose: () => void;
};

const kindLabel: Record<ServicePlanImportChangeKind, string> = {
  added: "Added",
  removed: "Removed",
  updated: "Updated",
};

const kindClassName: Record<ServicePlanImportChangeKind, string> = {
  added: "bg-emerald-400/10 text-emerald-200",
  removed: "bg-red-400/10 text-red-200",
  updated: "bg-cyan-400/10 text-cyan-200",
};

/** Item type changes still apply with the import; omit them from the review UI. */
const visibleFields = (change: ServicePlanImportSummary["changes"][number]) =>
  change.fields.filter((field) => field.label !== "Item type");

/** Review the exact result of a Service Planning refresh before applying it. */
const ServicePlanImportReviewWindow = ({
  summary,
  onApply,
  onClose,
}: ServicePlanImportReviewWindowProps) => {
  const changeCount = summary.changes.length;
  const summaryParts = [
    summary.added ? `${summary.added} added` : "",
    summary.updated ? `${summary.updated} updated` : "",
    summary.removed ? `${summary.removed} removed` : "",
  ].filter(Boolean);

  return (
    <FloatingWindow
      title="Review Service Planning updates"
      label="Import review"
      onClose={onClose}
      defaultWidth={720}
      defaultHeight={620}
      contentClassName="p-0"
    >
      <div className="flex h-full min-h-0 flex-col text-sm text-gray-100">
        <div className="border-b border-gray-700 px-4 py-3">
          <p className="font-medium">
            {changeCount
              ? `${changeCount} ${changeCount === 1 ? "change" : "changes"} ready to apply`
              : "No selected updates found"}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {summaryParts.length
              ? summaryParts.join(" · ")
              : "The current plan already matches the selected import options."}
          </p>
        </div>

        <div className="scrollbar-variable min-h-0 flex-1 overflow-y-auto p-3">
          {changeCount ? (
            <ul className="space-y-2" aria-label="Service Planning changes">
              {summary.changes.map((change) => {
                const fields = visibleFields(change);
                return (
                  <li
                    key={`${change.kind}:${change.id}`}
                    className="rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          kindClassName[change.kind],
                        )}
                      >
                        {kindLabel[change.kind]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-100">{change.itemName}</p>
                        <p className="mt-0.5 text-xs text-gray-400">{change.sectionName || "Untitled section"}</p>
                        {fields.length ? (
                          <div className="mt-2 grid grid-cols-1 gap-2 border-t border-gray-700/80 pt-2 sm:grid-cols-2">
                            {fields.map((field) => (
                              <div
                                key={field.label}
                                className="rounded-md border border-gray-700/80 bg-gray-950/40 px-2.5 py-2 text-xs"
                              >
                                <p className="font-medium text-cyan-200">{field.label}</p>
                                <p className="mt-1 wrap-break-word text-gray-500">
                                  <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-gray-600">Before</span>
                                  {field.before}
                                </p>
                                <p className="wrap-break-word text-gray-200">
                                  <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-300/70">After</span>
                                  {field.after}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-center text-sm text-gray-400">
              Nothing will change with the options currently selected.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-700 px-4 py-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="cta" svg={Check} onClick={onApply} disabled={!changeCount}>
            Apply {changeCount || "no"} {changeCount === 1 ? "change" : "changes"}
          </Button>
        </div>
      </div>
    </FloatingWindow>
  );
};

export default ServicePlanImportReviewWindow;
