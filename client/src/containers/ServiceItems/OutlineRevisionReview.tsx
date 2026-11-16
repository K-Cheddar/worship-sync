import isEqual from "lodash/isEqual";
import { useState } from "react";
import Button from "../../components/Button/Button";
import Modal from "../../components/Modal/Modal";
import type { ServiceItem } from "../../types";
import type { OutlineRemoteConflict } from "../../store/itemListSlice";
import {
  getOutlineItemConflicts,
  reconcileOutlineItems,
  type OutlineItemChoices,
  type OutlineMoveIntent,
} from "../../utils/outlineSync";

type Props = {
  conflict: OutlineRemoteConflict;
  draft: ServiceItem[];
  isOpen: boolean;
  onClose: () => void;
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
  return field ? "Keep this setting" : label(row);
};

const positionDescription = (rows: ServiceItem[], movedIds: string[]) => {
  const moved = new Set(movedIds);
  const indexes = rows.flatMap((row, index) => moved.has(row.listId) ? [index] : []);
  if (!indexes.length) return "The item was removed";
  const first = Math.min(...indexes);
  const last = Math.max(...indexes);
  const before = rows.slice(0, first).reverse().find(row => !moved.has(row.listId));
  const after = rows.slice(last + 1).find(row => !moved.has(row.listId));
  if (before && after) return `after ${label(before)} and before ${label(after)}`;
  if (before) return `after ${label(before)}`;
  if (after) return `before ${label(after)}`;
  return "at the beginning of the outline";
};

const intentDescription = (intent: OutlineMoveIntent | undefined, rows: ServiceItem[], movedIds: string[]) => {
  if (!intent) return positionDescription(rows, movedIds);
  const before = intent.beforeId ? rows.find(row => row.listId === intent.beforeId) : undefined;
  const after = intent.afterId ? rows.find(row => row.listId === intent.afterId) : undefined;
  if (before && after) return `after ${label(before)} and before ${label(after)}`;
  if (before) return `after ${label(before)}`;
  if (after) return `before ${label(after)}`;
  if (intent.edge === "start") return "at the beginning of the outline";
  if (intent.edge === "end") return "at the end of the outline";
  return "near its original position";
};

const orderPreview = (rows: ServiceItem[], movedIds: string[]) => {
  const moved = new Set(movedIds);
  const indexes = rows.flatMap((row, index) => moved.has(row.listId) ? [index] : []);
  if (!indexes.length) return [];
  const first = Math.max(0, Math.min(...indexes) - 1);
  const last = Math.min(rows.length - 1, Math.max(...indexes) + 1);
  const visible = rows.slice(first, last + 1);
  return [
    ...(first > 0 ? ["Earlier items"] : []),
    ...visible.map((row, index) => `${first + index + 1}. ${label(row)}`),
    ...(last < rows.length - 1 ? ["Later items"] : []),
  ];
};

/** Opens only for current authored conflicts; the sidebar itself stays navigable. */
export default function OutlineRevisionReview({ conflict, draft, isOpen, onClose, onSave }: Props) {
  return <Modal
    isOpen={isOpen}
    onClose={onClose}
    title="Review outline changes"
    description="Choose how to handle changes that could not be combined safely."
    size="lg"
    contentClassName="max-h-[85vh] overflow-hidden"
  >
    <Review key={JSON.stringify([conflict.baselineItems, conflict.remoteItems, draft, conflict.moveIntents])}
      conflict={conflict} draft={draft} onSave={onSave} />
  </Modal>;
}

function Review({ conflict, draft, onSave }: Omit<Props, "isOpen" | "onClose">) {
  const [choices, setChoices] = useState<OutlineItemChoices>({});
  const [wholeChoice, setWholeChoice] = useState<"local" | "remote">();
  const moves = conflict.moveIntents ?? [];
  const conflicts = getOutlineItemConflicts(conflict.baselineItems, draft, conflict.remoteItems, moves);
  const replacement = conflicts.some((entry) => entry.reason === "replacement");
  const result = reconcileOutlineItems(
    conflict.baselineItems, draft, conflict.remoteItems,
    entry => choices[entry.key], moves,
  );
  const pending = Boolean(conflict.resolutionChoice);
  const selected = wholeChoice === "local" ? draft : conflict.remoteItems;
  const canSave = !pending && (replacement ? Boolean(wholeChoice) : result.kind === "merged");

  return <div role="region" aria-label="Outline conflict decisions" aria-busy={pending} className="flex min-h-0 flex-col gap-3">
    <p className="text-sm text-white/80">Compatible edits are already included. Choose only for the overlapping changes below.</p>
    <div className="min-h-0 max-h-[55vh] space-y-3 overflow-y-auto pr-1">
      {replacement ? <>
        <p>Both Controllers replaced the same rows. Choose which current rows to keep.</p>
        {(["local", "remote"] as const).map(side => <Button key={side} disabled={pending}
          variant={wholeChoice === side ? "secondary" : "tertiary"} aria-pressed={wholeChoice === side}
          onClick={() => setWholeChoice(side)}>{side === "local" ? "My draft" : "Saved outline"}</Button>)}
        {wholeChoice && <div aria-label="Changes to discard" className="space-y-1 text-sm">
          <p>Rows that change:</p>
          {(wholeChoice === "local" ? conflict.remoteItems : draft).filter(row =>
            !selected.some(kept => isEqual(kept, row)))
            .map(row => <p key={row.listId}>{label(row)}</p>)}
        </div>}
      </> : conflicts.map(entry => {
        if (entry.reason === "order") {
          const movedIds = entry.movedIds ?? [];
          const localIntent = entry.localDestination;
          const intentGroup = localIntent?.movedIds ?? movedIds;
          const movedNames = intentGroup.map(id => label(draft.find(row => row.listId === id) ??
            conflict.remoteItems.find(row => row.listId === id)));
          const localOrder = draft.map(label);
          const savedOrder = conflict.remoteItems.map(label);
          return <fieldset key={entry.key} className="space-y-2 rounded border border-white/15 p-3">
            <legend className="px-1 text-sm font-semibold">{entry.orderAmbiguous ? "Outline order" : movedNames.join(", ") || "Outline order"}</legend>
            {entry.orderAmbiguous ? <>
              <p className="text-xs text-white/70">This saved draft has no recorded drag destination, so its order cannot be safely rebased.</p>
              <p className="text-xs text-white/70">My order: {localOrder.join(" → ")}.</p>
              <p className="text-xs text-white/70">Saved order: {savedOrder.join(" → ")}.</p>
            </> : <>
              <p className="text-xs text-white/70">Original: {positionDescription(conflict.baselineItems, intentGroup)}.</p>
              <p className="text-xs text-white/70">My move: {intentDescription(localIntent, draft, intentGroup)}.</p>
              <p className="text-xs text-white/70">Saved move: {positionDescription(conflict.remoteItems, intentGroup)}.</p>
            </>}
            <div className="flex flex-col gap-2 sm:flex-row">
              {(["local", "remote"] as const).map(side => {
                const destination = side === "local"
                  ? intentDescription(localIntent, draft, intentGroup)
                  : positionDescription(conflict.remoteItems, intentGroup);
                return <Button key={side} disabled={pending} className="flex-1 whitespace-normal"
                  aria-pressed={choices[entry.key] === side}
                  variant={choices[entry.key] === side ? "secondary" : "tertiary"}
                  onClick={() => setChoices(previous => ({ ...previous, [entry.key]: side }))}>
                  {entry.orderAmbiguous
                    ? side === "local" ? "Keep my order" : "Keep saved order"
                    : `${side === "local" ? "Keep my move" : "Keep saved move"}: ${destination}`}
                </Button>;
              })}
            </div>
            {result.items.length > 0 && <div aria-label="Resulting order preview" className="text-xs text-white/70">
              <p className="mb-1 font-semibold">Result near the moved row</p>
              {orderPreview(result.items, intentGroup).map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
            </div>}
          </fieldset>;
        }

        if (entry.reason === "delete-edit" && entry.movedIds?.length) {
          const movedIds = entry.movedIds;
          const localIntent = entry.localDestination;
          const name = label(entry.localRow ?? entry.remoteRow);
          const localSummary = localIntent
            ? `Move ${name} ${intentDescription(localIntent, draft, movedIds)}`
            : `Remove ${name}`;
          const savedSummary = entry.remoteMoved
            ? `Move ${name} ${positionDescription(conflict.remoteItems, movedIds)}`
            : `Remove ${name}`;
          return <fieldset key={entry.key} className="space-y-2 rounded border border-white/15 p-3">
            <legend className="px-1 text-sm font-semibold">{name}: move or delete</legend>
            <p className="text-xs text-white/70">Original: {positionDescription(conflict.baselineItems, movedIds)}.</p>
            <p className="text-xs text-white/70">My change: {localSummary}.</p>
            <p className="text-xs text-white/70">Saved change: {savedSummary}.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {(["local", "remote"] as const).map(side => <Button key={side} disabled={pending}
                className="flex-1 whitespace-normal" aria-pressed={choices[entry.key] === side}
                variant={choices[entry.key] === side ? "secondary" : "tertiary"}
                onClick={() => setChoices(previous => ({ ...previous, [entry.key]: side }))}>
                {side === "local" ? `Keep my change: ${localSummary}` : `Keep saved change: ${savedSummary}`}
              </Button>)}
            </div>
            {result.items.length > 0 && <div aria-label="Resulting order preview" className="text-xs text-white/70">
              <p className="mb-1 font-semibold">Result near the moved row</p>
              {orderPreview(result.items, movedIds).map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
            </div>}
          </fieldset>;
        }

        return <fieldset key={entry.key} className="space-y-2 rounded border border-white/15 p-3">
          <legend className="px-1 text-sm font-semibold">{label(entry.localRow ?? entry.remoteRow)}: {fieldLabel(entry.field)}</legend>
          {(["local", "remote"] as const).map(side => <Button key={side} disabled={pending}
            className="w-full whitespace-normal text-left" aria-pressed={choices[entry.key] === side}
            variant={choices[entry.key] === side ? "secondary" : "tertiary"}
            onClick={() => setChoices(previous => ({ ...previous, [entry.key]: side }))}>
            {side === "local" ? "My edit" : "Saved edit"}: {detail(side === "local" ? entry.localRow : entry.remoteRow, entry.field)}
          </Button>)}
        </fieldset>;
      })}
    </div>
    <div className="flex justify-end border-t border-white/10 pt-3">
      <Button variant="secondary" disabled={!canSave} isLoading={pending}
        onClick={() => { if (canSave) onSave(replacement ? selected : result.items); }}>
        {pending ? "Saving choices" : "Save choices"}
      </Button>
    </div>
  </div>;
}
