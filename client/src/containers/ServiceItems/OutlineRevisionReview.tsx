import { useState } from "react";
import isEqual from "lodash/isEqual";
import Button from "../../components/Button/Button";
import type { ServiceItem } from "../../types";
import type { OutlineRemoteConflict } from "../../store/itemListSlice";
import {
  outlineRevisionItemReview,
  outlineRevisionChoiceDocument,
  type OutlineRevisionSelection,
} from "../../utils/persistServiceListField";
import {
  getOutlineItemConflicts,
  reconcileOutlineItems,
  type OutlineItemChoices,
} from "../../utils/outlineSync";

const fieldLabel = (field: string) => ({
  name: "Name", type: "Item type", _id: "Item", background: "Background",
  localImage: "Local image", localVideoFile: "Local video", overlays: "Overlay order",
  servicePlanBinding: "Service plan", serviceOutline: "Service outline",
}[field] ?? field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()));

const describe = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return "None";
  if (Array.isArray(value)) return value.map(describe).join(", ") || "None";
  if (typeof value === "object") {
    return Object.entries(value).filter(([key]) => key !== "id" && !key.startsWith("_"))
      .map(([key, entry]) => `${fieldLabel(key)}: ${describe(entry)}`).join("; ") || "Saved setting";
  }
  return String(value);
};
const rowLabel = (row?: ServiceItem) => row ? `${row.name || "Untitled item"} (${row.type})` : "Remove this row";
const rowDetails = (row?: ServiceItem) => row
  ? [rowLabel(row), ...["background", "localImage", "localVideoFile"].filter((key) => key in row)
    .map((key) => `${fieldLabel(key)}: ${describe((row as unknown as Record<string, unknown>)[key])}`)].join(" — ")
  : "Remove this row";

type Props = {
  conflict: OutlineRemoteConflict;
  draft: ServiceItem[];
  pendingItems?: ServiceItem[];
  onSave: (items: ServiceItem[], selection: OutlineRevisionSelection) => void;
};

/** Mounted only for saved revision conflicts. A changed graph/draft remounts
 * the form so choices can never silently transfer to different content. */
export default function OutlineRevisionReview(props: Props) {
  return <Review key={JSON.stringify([props.conflict.revisionConflict, props.conflict.draftBaselineItems ?? props.conflict.baselineItems, props.draft])} {...props} />;
}

function Review({ conflict, draft, pendingItems, onSave }: Props) {
  const [choices, setChoices] = useState<OutlineItemChoices>({});
  const [wholeVersion, setWholeVersion] = useState<number>();
  const revision = conflict.revisionConflict!;
  const review = outlineRevisionItemReview(revision, draft, conflict.draftBaselineItems ?? conflict.baselineItems);
  const conflicts = review ? getOutlineItemConflicts(review.baselineItems, review.localItems, review.remoteItems) : [];
  const result = review ? reconcileOutlineItems(review.baselineItems, review.localItems, review.remoteItems,
    (entry) => choices[entry.key]) : undefined;
  const versions = [
    { label: "My draft", items: draft, revision: undefined, document: revision.remoteDocument ?? revision.versions[0]?.document },
    ...revision.versions.map((version, index) => ({ ...version, label: `Saved version ${index + 1}` })),
  ];
  const selected = wholeVersion === undefined ? undefined : versions[wholeVersion];
  const pending = Boolean(conflict.resolutionChoice);
  let preview = review ? result?.items : selected?.items;
  if (pending && pendingItems) preview = pendingItems;
  const previewDocument = selected?.document ? outlineRevisionChoiceDocument(revision, selected.document) : undefined;
  const allBranchesLoaded = revision.versions.length === revision.graph.conflictRevisions.length + 1;
  const canSave = allBranchesLoaded && !pending && (review ? result?.kind === "merged" : Boolean(selected));
  const saveLabel = review ? "Save choices" : "Save selected outline";
  const previewRows = (items: ServiceItem[]) => <ol className="list-decimal space-y-1 pl-5">
    {items.map((item, index) => <li key={`${item.listId}-${index}`} className="break-words">{rowDetails(item)}</li>)}
    {items.length === 0 && <li>No outline rows</li>}
  </ol>;

  return <section className="w-full min-w-0 space-y-3" aria-label="Review outline changes" aria-busy={pending}>
    <p>{review
      ? "Choose the conflicting changes below. Compatible edits, additions and removals stay in the combined outline."
      : "These versions could not be reconciled reliably. Choose a whole outline and review what it replaces. Independent changes in other versions may be discarded."}</p>
    {!allBranchesLoaded && <p>Some saved versions could not be loaded. Reopen the outline to try again before saving a choice.</p>}
    <div className="max-h-80 space-y-3 overflow-y-auto">
      {review ? conflicts.map((entry) => <fieldset key={entry.key} className="min-w-0 space-y-1">
        <legend className="font-semibold">{entry.reason === "order" ? "Outline order" : `${entry.localRow?.name ?? entry.remoteRow?.name ?? "Outline row"}: ${entry.field ? fieldLabel(entry.field) : "Row changes"}`}</legend>
        {entry.reason === "delete-edit" && <p>One version removes this row; the other keeps a changed row.</p>}
        {(["local", "remote"] as const).map((side) => {
          const row = side === "local" ? entry.localRow : entry.remoteRow;
          let detail = rowDetails(row);
          if (entry.reason === "order") detail = (side === "local" ? review.localItems : review.remoteItems).map((item) => item.name).join(" → ");
          else if (entry.field && entry.field !== "_id") detail = `${rowLabel(row)} — ${fieldLabel(entry.field)}: ${describe((row as unknown as Record<string, unknown> | undefined)?.[entry.field])}`;
          return <Button key={side} variant={choices[entry.key] === side ? "secondary" : "tertiary"}
            className="w-full justify-start whitespace-normal break-words text-left" disabled={pending}
            aria-pressed={choices[entry.key] === side}
            onClick={() => setChoices((previous) => ({ ...previous, [entry.key]: side }))}>
            {side === "local" ? "First version" : "Second version"}: {detail}
          </Button>;
        })}
      </fieldset>) : versions.map((version, index) => <div key={version.label} className="space-y-1">
        <Button variant={wholeVersion === index ? "secondary" : "tertiary"} disabled={pending}
          aria-pressed={wholeVersion === index} onClick={() => setWholeVersion(index)}>{version.label}</Button>
        {version.document && revision.documentConflicts?.map((field) => <p key={field} className="break-words">
          {fieldLabel(field)}: {describe((version.document as unknown as Record<string, unknown>)[field])}
        </p>)}
        {previewRows(version.items)}
      </div>)}
      {preview && <div className="space-y-1" aria-label="Resulting outline">
        <p className="font-semibold">{review && !pending && result?.kind !== "merged" ? "Outline preview — choose each conflict to finish" : "Resulting outline"}</p>
        {previewRows(preview)}
        {previewDocument && revision.documentConflicts?.map((field) => <p key={field} className="break-words">
          {fieldLabel(field)}: {describe((previewDocument as unknown as Record<string, unknown>)[field])}
        </p>)}
      </div>}
      {selected && !review && <div aria-label="Discarded content" className="space-y-2">
        <p className="font-semibold">Content replaced or removed from other versions</p>
        {versions.filter((version) => version !== selected).map((version) => {
          const changed = version.items.filter((item) => !preview?.some((row) => isEqual(item, row)));
          const selectedDocument = previewDocument;
          const document = version.document;
          const changedFields = document && selectedDocument ? [...new Set([...Object.keys(document), ...Object.keys(selectedDocument)])]
            .filter((key) => !key.startsWith("_") && !["items", "updatedAt"].includes(key) &&
              !isEqual((document as unknown as Record<string, unknown>)[key], (selectedDocument as unknown as Record<string, unknown>)[key])) : [];
          return <div key={version.label}>
            <p>{version.label}: {changed.length ? "These rows will be removed or replaced:" : "No rows removed or replaced."}</p>
            {changed.length > 0 && previewRows(changed)}
            {changedFields.map((field) => <p key={field} className="break-words">
              {fieldLabel(field)} replaced: {describe((document as unknown as Record<string, unknown>)[field])}
              {" → "}{describe((selectedDocument as unknown as Record<string, unknown>)[field])}
            </p>)}
          </div>;
        })}
      </div>}
    </div>
    <Button variant="secondary" disabled={!canSave} isLoading={pending} onClick={() => {
      if (!canSave || !preview) return;
      onSave(preview, review ? { kind: "rows", review, choices } : { kind: "whole", revision: selected?.revision });
    }}>{pending ? "Saving choices" : saveLabel}</Button>
  </section>;
}
