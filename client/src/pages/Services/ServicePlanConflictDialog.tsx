import Modal from "../../components/Modal/Modal";
import Button from "../../components/Button/Button";
import type { ServicePlanMergeConflict } from "./servicePlanMerge";
import { richTextToPlainText } from "../../types/richText";

type Props = {
  conflicts: ServicePlanMergeConflict[];
  choices: Record<string, "local" | "remote">;
  onChoose: (path: string, choice: "local" | "remote") => void;
  onApply: () => void;
  applying: boolean;
  onUseLatest: () => void;
  onCancel: () => void;
};

const displayValue = (value: unknown) => {
  if (value === undefined) return "Deleted";
  if (typeof value === "string") return value || "Empty";
  if (value && typeof value === "object" && "blocks" in value) {
    const text = richTextToPlainText(value as Parameters<typeof richTextToPlainText>[0]);
    if (text) return text;
  }
  if (Array.isArray(value) && value.every((entry) => entry && typeof entry === "object" && "type" in entry)) {
    const text = richTextToPlainText({ blocks: value } as Parameters<typeof richTextToPlainText>[0]);
    if (text) return text;
  }
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
};

const ServicePlanConflictDialog = ({ conflicts, choices, onChoose, onApply, applying, onUseLatest, onCancel }: Props) => (
  <Modal isOpen title="Review plan changes" description="Choose which version to keep for each conflicting change." onClose={onCancel} size="xl">
    <div className="space-y-4">
      <p className="text-sm text-gray-300">Your other changes will be combined automatically. Cancel keeps your draft so you can resolve this later.</p>
      <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
        {conflicts.map((conflict) => (
          <section key={conflict.path} className="rounded-lg border border-gray-700 p-3">
            <h3 className="mb-2 text-sm font-semibold text-white">{conflict.label}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["local", "remote"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  aria-pressed={choices[conflict.path] === side}
                  onClick={() => onChoose(conflict.path, side)}
                  className={`rounded-md border p-2 text-left ${choices[conflict.path] === side ? "border-cyan-500 bg-cyan-950/40" : "border-gray-700 bg-gray-900"}`}
                >
                  <span className="text-xs font-semibold uppercase text-gray-300">{side === "local" ? "Local" : "Remote"}</span>
                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-100">{displayValue(side === "local" ? conflict.localValue : conflict.remoteValue)}</pre>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-gray-700 pt-3">
        <Button variant="tertiary" disabled={applying} onClick={onCancel}>Cancel</Button>
        <Button variant="tertiary" disabled={applying} onClick={onUseLatest}>Use latest and discard local changes</Button>
        <Button variant="cta" disabled={applying || conflicts.some(({ path }) => !choices[path])} onClick={onApply}>
          {applying ? "Checking latest…" : "Apply merged plan"}
        </Button>
      </div>
    </div>
  </Modal>
);

export default ServicePlanConflictDialog;
