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
import type { ServicePlanElement, ServicePlanSection } from "../../types/servicePlan";
import { getServicePlanElementAssigneeNames } from "../../types/servicePlan";
import { richTextToPlainText } from "../../types/richText";

type ServicePlanImportReviewWindowProps = {
  summary: ServicePlanImportSummary;
  currentSections?: ServicePlanSection[];
  proposedSections?: ServicePlanSection[];
  importedSections?: ServicePlanSection[];
  importLabel?: string;
  getSelectedSections?: (keys: string[]) => ServicePlanSection[] | undefined;
  onApply: (selectedChangeKeys: string[]) => void;
  onClose: () => void;
};

const kindLabel: Record<ServicePlanImportChangeKind, string> = {
  added: "Added",
  removed: "Removed",
  updated: "Updated",
  moved: "Moved",
  legacy_match: "Confirm Match",
  linked: "Linked",
};

const kindClassName: Record<ServicePlanImportChangeKind, string> = {
  added: "bg-emerald-400/10 text-emerald-200",
  removed: "bg-red-400/10 text-red-200",
  updated: "bg-cyan-400/10 text-cyan-200",
  moved: "bg-violet-400/10 text-violet-200",
  legacy_match: "bg-amber-400/10 text-amber-100",
  linked: "bg-indigo-400/10 text-indigo-200",
};

/** Item type changes still apply with the import; omit them from the review UI. */
const visibleFields = (change: ServicePlanImportSummary["changes"][number]) =>
  change.fields.filter((field) => field.label !== "Item type" && field.label !== "Resulting time and duration");

const checkboxLabel = (change: ServicePlanImportSummary["changes"][number]) => {
  if (change.kind === "legacy_match") return `Confirm match for ${change.itemName}`;
  if (change.kind === "linked") return `Link ${change.itemName} to the import source`;
  if (change.kind === "removed") return `Remove ${change.itemName}`;
  if (change.kind === "added") return `Add ${change.itemName}`;
  return `${change.kind === "moved" ? (change.fromSectionId === change.sectionId ? "Reorder" : "Move") : "Update"} ${change.itemName}`;
};

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
  currentSections = [],
  proposedSections = [],
  importedSections = proposedSections,
  importLabel = "Updated PDF",
  getSelectedSections,
  onApply,
  onClose,
}: ServicePlanImportReviewWindowProps) => {
  const bulkChangeKeys = useMemo(
    () => summary.changes
      .filter((change) => change.kind !== "legacy_match")
      .map(servicePlanImportChangeKey),
    [summary.changes],
  );
  const [selectedChangeKeys, setSelectedChangeKeys] = useState<Set<string>>(
    () => new Set(summary.changes
      .filter((change) => change.kind !== "legacy_match")
      .map(servicePlanImportChangeKey)),
  );
  const selectedChanges = summary.changes.filter((change) =>
    selectedChangeKeys.has(servicePlanImportChangeKey(change)),
  );
  const changeCount = selectedChanges.length;
  const initialGeometry = useMemo(getInitialReviewWindowGeometry, []);
  const matches = summary.changes.filter((change) => change.kind === "legacy_match");
  const ordinaryChanges = summary.changes.filter((change) => change.kind !== "legacy_match");
  const changesBySection = new Map<string, typeof summary.changes>();
  ordinaryChanges.forEach((change) => {
    const changes = changesBySection.get(change.sectionId) || [];
    changes.push(change);
    changesBySection.set(change.sectionId, changes);
  });
  const findItem = (sections: ServicePlanSection[], id: string | undefined) =>
    sections.flatMap((section) => section.elements.map((element, index) => ({ element, index, section })))
      .find(({ element }) => element.id === id);
  const selectedSections = getSelectedSections?.([...selectedChangeKeys]);
  const timingChanges = selectedSections ? selectedSections.flatMap((section) => section.elements.flatMap((element) => {
    const current = findItem(currentSections, element.id);
    const before = current?.element.startTime;
    return current && before !== element.startTime && (before || element.startTime)
      ? [{ id: element.id, name: richTextToPlainText(element.title).trim() || "Untitled item", before: before || "No start time", after: element.startTime || "No start time" }]
      : [];
  })) : [];
  const itemDetails = (element: ServicePlanElement | undefined, position: number | undefined) => {
    if (!element) return null;
    const duration = element.durationSeconds ?? (element.durationMinutes ?? 0) * 60;
    const notes = [richTextToPlainText(element.notes), ...(element.teamNotes || []).map((note) => { const value = richTextToPlainText(note.note).trim(); return value ? `${note.label}: ${value}` : ""; })].filter((note) => note.trim());
    return <div className="min-w-0 break-words text-xs text-gray-300">
      <p className="font-medium text-gray-100">{richTextToPlainText(element.title).trim() || "Untitled item"}</p>
      <p>{[position !== undefined ? `Position ${position + 1}` : "", element.startTime || "", duration ? `${Math.floor(duration / 60)}m${duration % 60 ? ` ${duration % 60}s` : ""}` : ""].filter(Boolean).join(" \u00b7 ")}</p>
      {getServicePlanElementAssigneeNames(element).length ? <p>{getServicePlanElementAssigneeNames(element).join(", ")}</p> : null}
      {notes.length ? <p className="whitespace-pre-wrap">{notes.join(" \u00b7 ")}</p> : null}
    </div>;
  };

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
          <p className="font-medium">{changeCount} {changeCount === 1 ? "change" : "changes"} selected {"\u00b7"} {matches.length} possible {matches.length === 1 ? "match" : "matches"}</p>
          <p className="mt-1 text-xs text-gray-400">Possible matches require individual confirmation and are excluded from Select all updates.</p>
        </div>

        <div className="scrollbar-variable min-h-0 flex-1 overflow-y-auto p-3">
          {summary.changes.length ? (
            <div className="space-y-4">
              {matches.length ? <section aria-label="Possible matches">
                <h3 className="font-semibold text-amber-100">Possible matches</h3>
                <p className="mt-1 text-xs text-gray-400">These items may represent the same part of the service. Confirm each match before applying its updates.</p>
                <p className="mt-1 text-xs text-gray-400">Checking confirms both items are the same occurrence. Leave unchecked to preserve the current item without associating it with the imported occurrence.</p>
                <ul className="mt-2 space-y-2">{matches.map((change) => {
                  const current = findItem(currentSections, change.id);
                  const incoming = findItem(importedSections, change.incomingElementId);
                  const proposed = findItem(proposedSections, change.incomingElementId);
                  const key = servicePlanImportChangeKey(change);
                  return <li key={key} className="rounded-md border border-amber-700/50 bg-gray-900/70 p-3">
                    <Checkbox label={checkboxLabel(change)} checked={selectedChangeKeys.has(key)} onCheckedChange={(checked) => setSelected([key], checked)} />
                    {change.fromSectionId && change.fromSectionId !== change.sectionId ? <p className="mt-1 text-xs text-violet-200">{change.fromSectionName || "Previous section"} {"\u2192"} {change.sectionName}</p> : null}
                    {current && incoming ? <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div><p className="text-xs font-semibold text-amber-200">Current plan</p>{itemDetails(current.element, current.index)}</div>
                      <div><p className="text-xs font-semibold text-amber-200">{importLabel}</p>{itemDetails(incoming.element, proposed?.index ?? incoming.index)}</div>
                    </div> : <div className="mt-2 text-xs">{visibleFields(change).map((field) => <p key={field.label}><span>{field.before}</span> {"\u2192"} <span>{field.after}</span></p>)}</div>}
                  </li>;
                })}</ul>
              </section> : null}
              {ordinaryChanges.length ? <section aria-label="Proposed changes">
                <h3 className="mb-2 font-semibold">Proposed changes</h3>
                <Checkbox label="Select all updates" checked={bulkChangeKeys.length > 0 && bulkChangeKeys.every((key) => selectedChangeKeys.has(key))} onCheckedChange={(checked) => setSelected(bulkChangeKeys, checked)} className="border-b border-gray-700 pb-3" />
                <ul className="mt-3 space-y-3" aria-label="Service Planning changes">{[...changesBySection.values()].map((sectionChanges) => {
                  const sectionKeys = sectionChanges.map(servicePlanImportChangeKey);
                  return <li key={sectionChanges[0].sectionId} className="rounded-lg border border-gray-700 bg-gray-900/70">
                    <Checkbox label={sectionChanges[0].sectionName || "Untitled section"} checked={sectionKeys.every((key) => selectedChangeKeys.has(key))} onCheckedChange={(checked) => setSelected(sectionKeys, checked)} className="border-b border-gray-700 px-3 py-2" labelClassName="font-medium" />
                    <ul className="space-y-2 p-2">{sectionChanges.map((change) => {
                      const key = servicePlanImportChangeKey(change);
                      const reordered = change.kind === "moved" && change.fromSectionId === change.sectionId;
                      const current = findItem(currentSections, change.id);
                      const incoming = findItem(selectedChangeKeys.has(key) && selectedSections ? selectedSections : proposedSections, change.id);
                      return <li key={key} className="rounded-md border border-gray-700/80 bg-gray-950/40 px-3 py-2">
                        <div className="flex items-start gap-2">
                          <Checkbox label={checkboxLabel(change)} checked={selectedChangeKeys.has(key)} onCheckedChange={(checked) => setSelected([key], checked)} className="pt-0.5" hideLabel />
                          <span className={cn("mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", kindClassName[change.kind])}>{reordered ? "Reordered" : kindLabel[change.kind]}</span>
                          <div className="min-w-0 flex-1"><p className="break-words font-medium text-gray-100">{change.itemName}</p>
                            {change.kind === "moved" && !reordered ? <p className="mt-1 text-xs text-violet-200">{change.fromSectionName || "Previous section"} {"\u2192"} {change.sectionName}</p> : null}
                            {reordered && current && incoming ? <p className="mt-1 text-xs text-violet-200">Position {current.index + 1} {"\u2192"} {incoming.index + 1}</p> : null}
                            {visibleFields(change).length ? <div className="mt-2 grid grid-cols-1 gap-2 border-t border-gray-700/80 pt-2 sm:grid-cols-2">{visibleFields(change).map((field) => <div key={field.label} className="rounded-md border border-gray-700/80 bg-gray-950/40 px-2.5 py-2 text-xs"><p className="font-medium text-cyan-200">{field.label}</p><p className="mt-1 break-words text-gray-400"><span className="mr-1 font-semibold">Before</span>{field.before}</p><p className="break-words text-gray-200"><span className="mr-1 font-semibold">After</span>{field.after}</p></div>)}</div> : null}
                          </div>
                        </div>
                      </li>;
                    })}</ul>
                  </li>;
                })}</ul>
              </section> : null}
              {getSelectedSections ? <details className="border-t border-gray-700 pt-3"><summary className="cursor-pointer font-semibold">Schedule impact ({timingChanges.length})</summary><p className="mt-1 text-xs text-gray-400">Timing reflects the selected changes.</p>{timingChanges.length ? <ul className="mt-2 space-y-1 text-xs">{timingChanges.map((change) => <li key={change.id}>{change.name} {"\u00b7"} {change.before} {"\u2192"} {change.after}</li>)}</ul> : <p className="mt-2 text-xs text-gray-400">No start time changes for existing items.</p>}</details> : null}
            </div>
          ) : <p className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-center text-sm text-gray-400">Nothing will change with the options currently selected.</p>}

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
