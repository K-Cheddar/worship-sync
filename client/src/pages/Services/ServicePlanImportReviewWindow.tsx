import FloatingWindow from "../../components/FloatingWindow/FloatingWindow";
import Button from "../../components/Button/Button";
import Checkbox from "../../components/Checkbox/Checkbox";
import { cn } from "../../utils/cnHelper";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ServicePlanImportChangeKind,
  ServicePlanImportSummary,
} from "./servicePlanImportSummary";
import { servicePlanImportChangeKey } from "./servicePlanImportSummary";

type ServicePlanImportReviewWindowProps = {
  summary: ServicePlanImportSummary;
  onApply: (selectedChangeKeys: string[]) => void;
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

const getInitialReviewWindowGeometry = () => {
  // The desktop workspace gives the preview column roughly one third of the
  // available width. Open the review alongside it, at the same edge and
  // height, so the service plan remains visible underneath.
  const width = Math.max(288, Math.round(window.innerWidth / 3));
  return {
    width,
    position: { x: window.innerWidth - width, y: 0 },
  };
};

/** Review the exact result of a Service Planning refresh before applying it. */
const ServicePlanImportReviewWindow = ({
  summary,
  onApply,
  onClose,
}: ServicePlanImportReviewWindowProps) => {
  const changeKeys = useMemo(
    () => summary.changes.map(servicePlanImportChangeKey),
    [summary.changes],
  );
  const [selectedChangeKeys, setSelectedChangeKeys] = useState<Set<string>>(
    () => new Set(changeKeys),
  );
  const selectedChanges = summary.changes.filter((change) =>
    selectedChangeKeys.has(servicePlanImportChangeKey(change)),
  );
  const changeCount = selectedChanges.length;
  const initialGeometry = useMemo(getInitialReviewWindowGeometry, []);
  const summaryParts = [
    selectedChanges.filter((change) => change.kind === "added").length
      ? `${selectedChanges.filter((change) => change.kind === "added").length} added`
      : "",
    selectedChanges.filter((change) => change.kind === "updated").length
      ? `${selectedChanges.filter((change) => change.kind === "updated").length} updated`
      : "",
    selectedChanges.filter((change) => change.kind === "removed").length
      ? `${selectedChanges.filter((change) => change.kind === "removed").length} removed`
      : "",
  ].filter(Boolean);
  const changesBySection = useMemo(() => {
    const sections = new Map<string, typeof summary.changes>();
    summary.changes.forEach((change) => {
      const changes = sections.get(change.sectionId) || [];
      changes.push(change);
      sections.set(change.sectionId, changes);
    });
    return [...sections.values()];
  }, [summary]);

  const setSelected = (changeKeysToSet: string[], checked: boolean) => {
    setSelectedChangeKeys((current) => {
      const next = new Set(current);
      changeKeysToSet.forEach((key) => {
        if (checked) next.add(key);
        else next.delete(key);
      });
      return next;
    });
  };

  return (
    <FloatingWindow
      title="Review Service Planning updates"
      label="Import review"
      onClose={onClose}
      defaultPosition={initialGeometry.position}
      defaultWidth={initialGeometry.width}
      defaultHeight={window.innerHeight}
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
          {summary.changes.length ? (
            <div className="space-y-3">
              <Checkbox
                label="Select all updates"
                checked={selectedChangeKeys.size === changeKeys.length}
                onCheckedChange={(checked) => setSelected(changeKeys, checked)}
                className="border-b border-gray-700 pb-3"
              />
              <ul className="space-y-3" aria-label="Service Planning changes">
                {changesBySection.map((sectionChanges) => {
                  const sectionChangeKeys = sectionChanges.map(servicePlanImportChangeKey);
                  const sectionName = sectionChanges[0]?.sectionName || "Untitled section";
                  return (
                    <li key={sectionChanges[0]?.sectionId} className="rounded-lg border border-gray-700 bg-gray-900/70">
                      <Checkbox
                        label={sectionName}
                        checked={sectionChangeKeys.every((key) => selectedChangeKeys.has(key))}
                        onCheckedChange={(checked) => setSelected(sectionChangeKeys, checked)}
                        className="border-b border-gray-700 px-3 py-2"
                        labelClassName="font-medium"
                      />
                      <ul className="space-y-2 p-2">
                        {sectionChanges.map((change) => {
                          const fields = visibleFields(change);
                          const changeKey = servicePlanImportChangeKey(change);
                          return (
                            <li key={changeKey} className="rounded-md border border-gray-700/80 bg-gray-950/40 px-3 py-2">
                              <div className="flex items-start gap-2">
                                <Checkbox
                                  label={`Update ${change.itemName}`}
                                  checked={selectedChangeKeys.has(changeKey)}
                                  onCheckedChange={(checked) => setSelected([changeKey], checked)}
                                  className="pt-0.5"
                                  hideLabel
                                />
                                <span
                                  className={cn(
                                    "mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                    kindClassName[change.kind],
                                  )}
                                >
                                  {kindLabel[change.kind]}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-medium text-gray-100">{change.itemName}</p>
                                  {fields.length ? (
                                    <div className="mt-2 grid grid-cols-1 gap-2 border-t border-gray-700/80 pt-2 sm:grid-cols-2">
                                      {fields.map((field) => (
                                        <div key={field.label} className="rounded-md border border-gray-700/80 bg-gray-950/40 px-2.5 py-2 text-xs">
                                          <p className="font-medium text-cyan-200">{field.label}</p>
                                          <p className="mt-1 wrap-break-word text-gray-500"><span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-gray-600">Before</span>{field.before}</p>
                                          <p className="wrap-break-word text-gray-200"><span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-300/70">After</span>{field.after}</p>
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
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-center text-sm text-gray-400">
              Nothing will change with the options currently selected.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-700 px-4 py-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="cta" svg={Check} onClick={() => onApply([...selectedChangeKeys])} disabled={!changeCount}>
            Apply {changeCount || "no"} {changeCount === 1 ? "change" : "changes"}
          </Button>
        </div>
      </div>
    </FloatingWindow>
  );
};

export default ServicePlanImportReviewWindow;
