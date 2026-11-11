import isEqual from "lodash/isEqual";
import { useState } from "react";
import Button from "../../components/Button/Button";
import type { ServiceItem } from "../../types";
import type { OutlineRemoteConflict } from "../../store/itemListSlice";
import { getOutlineItemConflicts, reconcileOutlineItems, type OutlineItemChoices } from "../../utils/outlineSync";

type Props = {
  conflict: OutlineRemoteConflict;
  draft: ServiceItem[];
  onSave: (items: ServiceItem[]) => void;
};

const fieldLabel = (field?: string) => ({
  name: "Name", type: "Item type", _id: "Item", background: "Background",
  localImage: "Local image", localVideoFile: "Local video",
}[field ?? ""] ?? "Row changes");
const label = (row?: ServiceItem) => row?.name || "Removed row";
const detail = (row: ServiceItem | undefined, field?: string) => {
  if (!row) return "Remove this row";
  if (field === "name") return row.name;
  if (field === "type") return row.type;
  // Media URLs and local asset metadata do not help a live operator decide.
  return field ? "Keep this setting" : label(row);
};

/** Only current edits participate; saved historical branches never reach here. */
export default function OutlineRevisionReview(props: Props) {
  return <Review key={JSON.stringify([props.conflict.baselineItems, props.conflict.remoteItems, props.draft])} {...props} />;
}

function Review({ conflict, draft, onSave }: Props) {
  const [choices, setChoices] = useState<OutlineItemChoices>({});
  const [wholeChoice, setWholeChoice] = useState<"local" | "remote">();
  const conflicts = getOutlineItemConflicts(conflict.baselineItems, draft, conflict.remoteItems);
  const replacement = conflicts.some((entry) => entry.reason === "replacement");
  const result = reconcileOutlineItems(conflict.baselineItems, draft, conflict.remoteItems, (entry) => choices[entry.key]);
  const pending = Boolean(conflict.resolutionChoice);
  const selected = wholeChoice === "local" ? draft : conflict.remoteItems;
  const canSave = !pending && (replacement ? Boolean(wholeChoice) : result.kind === "merged");
  return <section aria-label="Review outline changes" aria-busy={pending} className="w-full min-w-0 space-y-2">
    <p>Review overlapping edits. Compatible changes stay in the outline.</p>
    <div className="max-h-48 space-y-2 overflow-y-auto">
      {replacement ? <>
        <p>Both sessions replaced the same rows. Choose which current outline to keep.</p>
        {(["local", "remote"] as const).map((side) => <Button key={side} disabled={pending}
          variant={wholeChoice === side ? "secondary" : "tertiary"} aria-pressed={wholeChoice === side}
          onClick={() => setWholeChoice(side)}>{side === "local" ? "My draft" : "Saved outline"}</Button>)}
        {wholeChoice && <div aria-label="Changes to discard">
          <p>These current rows will be replaced or removed:</p>
          {(wholeChoice === "local" ? conflict.remoteItems : draft).filter((row) =>
            !selected.some((kept) => isEqual(kept, row)))
            .map((row) => <p key={row.listId}>{label(row)}</p>)}
        </div>}
      </> : conflicts.map((entry) => <fieldset key={entry.key} className="min-w-0 space-y-1">
        <legend>{entry.reason === "order" ? "Outline order" : `${label(entry.localRow ?? entry.remoteRow)}: ${fieldLabel(entry.field)}`}</legend>
        {entry.reason === "order" && <details>
          <summary className="cursor-pointer">Review changed positions</summary>
          {(["local", "remote"] as const).map((side) => <div key={side}>
            <p>{side === "local" ? "My order" : "Saved order"}</p>
            {(side === "local" ? draft : conflict.remoteItems).map((row, index) => ({ row, index }))
              .filter(({ row, index }) => conflict.baselineItems[index]?.listId !== row.listId)
              .map(({ row, index }) => <p key={row.listId}>{index + 1}. {label(row)}</p>)}
          </div>)}
        </details>}
        {(["local", "remote"] as const).map((side) => <Button key={side} disabled={pending}
          className="w-full whitespace-normal text-left" aria-pressed={choices[entry.key] === side}
          variant={choices[entry.key] === side ? "secondary" : "tertiary"}
          onClick={() => setChoices((previous) => ({ ...previous, [entry.key]: side }))}>
          {side === "local" ? "My edit" : "Saved edit"}: {entry.reason === "order" ? "Keep this order" : detail(side === "local" ? entry.localRow : entry.remoteRow, entry.field)}
        </Button>)}
      </fieldset>)}
    </div>
    <Button variant="secondary" disabled={!canSave} isLoading={pending}
      onClick={() => { if (canSave) onSave(replacement ? selected : result.items); }}>
      {pending ? "Saving choices" : "Save choices"}
    </Button>
  </section>;
}
