import {
  type FormEvent,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import Drawer from "../../components/Drawer";
import Button from "../../components/Button/Button";
import DeleteModal from "../../components/Modal/DeleteModal";
import Input from "../../components/Input/Input";
import TextArea from "../../components/TextArea/TextArea";
import { Pencil, Save, Search, Trash2, X } from "lucide-react";
import { useDispatch, useSelector } from "../../hooks";
import { RootState } from "../../store/store";
import {
  deleteOverlayHistoryEntry,
  updateOverlayHistoryEntry,
} from "../../store/overlaysSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import {
  putOverlayHistoryDoc,
  removeOverlayHistoryDoc,
} from "../../utils/dbUtils";
import type { OverlayHistoryKey } from "../../types";
import { cn } from "../../utils/cnHelper";

const OVERLAY_HISTORY_KEY_LABELS: Record<OverlayHistoryKey, string> = {
  "participant.name": "Participant – Name",
  "participant.title": "Participant – Title",
  "participant.event": "Participant – Event",
  "stick-to-bottom.heading": "Stick to bottom – Heading",
  "stick-to-bottom.subHeading": "Stick to bottom – Subheading",
  "qr-code.url": "QR code – URL",
  "qr-code.description": "QR code – Description",
  "image.name": "Image – Name",
};

type OverlayHistoryDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  position?: "left" | "right" | "top" | "bottom";
};

const OverlayHistoryDrawer = ({
  isOpen,
  onClose,
  size = "lg",
  position = "right",
}: OverlayHistoryDrawerProps) => {
  const dispatch = useDispatch();
  const { db } = useContext(ControllerInfoContext) ?? {};
  const overlayHistory = useSelector(
    (state: RootState) => state.undoable.present.overlays.overlayHistory
  );
  const [keyToDelete, setKeyToDelete] = useState<string | null>(null);
  const [editingDrafts, setEditingDrafts] = useState<Record<string, string>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const entries = useMemo(
    () =>
      Object.entries(overlayHistory)
        .filter(([key]) =>
          (OVERLAY_HISTORY_KEY_LABELS as Record<string, string>)[key]
        )
        .map(([key, values]) => [
          key,
          values,
          (OVERLAY_HISTORY_KEY_LABELS as Record<string, string>)[key] ?? key,
        ] as [string, string[], string])
        .sort(([, , labelA], [, , labelB]) => labelA.localeCompare(labelB))
        .filter(([key, values]) => {
          const q = searchQuery.trim().toLowerCase();
          if (!q) return true;
          const label = (OVERLAY_HISTORY_KEY_LABELS as Record<string, string>)[key] ?? key;
          if (label.toLowerCase().includes(q)) return true;
          return values.some((v) => v.toLowerCase().includes(q));
        }),
    [overlayHistory, searchQuery]
  );

  const handleDeleteConfirm = async () => {
    if (keyToDelete == null) return;
    dispatch(deleteOverlayHistoryEntry(keyToDelete));
    if (db) {
      removeOverlayHistoryDoc(db, keyToDelete).catch(console.error);
    }
    setKeyToDelete(null);
  };

  const handleSaveItem = useCallback(
    (key: string) => {
      const draft = editingDrafts[key];
      const currentValues = overlayHistory[key] ?? [];
      const newValues =
        draft !== undefined
          ? draft
            .split(/\n/)
            .map((s) => s.trim())
            .filter(Boolean)
          : currentValues;
      if (JSON.stringify(newValues) !== JSON.stringify(currentValues)) {
        dispatch(updateOverlayHistoryEntry({ key, values: newValues }));
        if (db) {
          putOverlayHistoryDoc(db, key, newValues).catch(console.error);
        }
      }
      setEditingDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setEditingKey(null);
    },
    [dispatch, db, editingDrafts, overlayHistory]
  );

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title="Overlay history"
        position={position}
        size={size}
        contentClassName="overflow-auto flex-1 min-h-0 flex flex-col text-white"
      >
        <p className="text-sm text-gray-400 pb-2">
          Suggestions come from previously entered values
        </p>
        <div className="flex flex-col gap-2 p-2 shrink-0 border-b border-gray-700">
          <Input
            label="Search"
            className="flex-1 min-w-[120px]"
            value={searchQuery}
            onChange={(val) => setSearchQuery((val as string) ?? "")}
            placeholder="Search by field or value..."
            hideLabel
            svgAction={searchQuery ? () => setSearchQuery("") : undefined}
            svg={searchQuery ? X : Search}
          />
        </div>

        <ul className="scrollbar-thin flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 p-2">
          {entries.map(([key, values], index) => {
            const label =
              (OVERLAY_HISTORY_KEY_LABELS as Record<string, string>)[key] ?? key;
            const isEditing = editingKey === key;
            const draftText = editingDrafts[key] ?? values.join("\n");
            const effectiveValues =
              editingDrafts[key] !== undefined
                ? draftText
                  .split(/\n/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                : values;
            const valueCount = effectiveValues.length;
            const rowBg = index % 2 === 0 ? "bg-gray-800" : "bg-gray-600";
            return (
              <li
                key={key}
                className={cn(
                  "flex flex-col rounded-lg overflow-clip border border-gray-600 px-2 py-1.5 gap-1.5",
                  rowBg
                )}
              >
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <span className="text-sm font-medium truncate" title={label}>
                    {label}
                  </span>
                  <span className="text-xs text-gray-400 shrink-0">
                    {valueCount} {valueCount === 1 ? "value" : "values"}
                  </span>
                </div>
                {isEditing ? (
                  <TextArea
                    label="History values"
                    hideLabel
                    value={draftText}
                    onChange={(eOrVal) => {
                      const s =
                        typeof eOrVal === "string"
                          ? eOrVal
                          : (eOrVal as FormEvent<HTMLTextAreaElement>)
                            .currentTarget.value;
                      setEditingDrafts((prev) => ({ ...prev, [key]: s }));
                    }}
                    autoResize
                    className="min-w-0"
                    textareaClassName="text-xs text-gray-300 bg-gray-900/50 border border-gray-600 rounded px-2 py-1 min-h-[2rem] resize-none"
                  />
                ) : (
                  <div className="text-xs text-gray-300 wrap-break-word min-w-0 flex flex-col gap-0.5">
                    {values.map((v, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-1"
                      >
                        <span className="min-w-0 truncate">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between gap-1">
                  {isEditing ? (
                    <>
                      <Button
                        variant="tertiary"
                        className="text-xs"
                        svg={Save}
                        padding="px-2 py-1"
                        color="#22d3ee"
                        onClick={() => handleSaveItem(key)}
                      >
                        Save
                      </Button>
                      <Button
                        variant="tertiary"
                        className="text-xs"
                        svg={X}
                        padding="px-2 py-1"
                        color="red"
                        onClick={() => {
                          setEditingDrafts((prev) => {
                            const next = { ...prev };
                            delete next[key];
                            return next;
                          });
                          setEditingKey(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="tertiary"
                          className="text-xs"
                          svg={Pencil}
                          padding="px-2 py-1"
                          color="#eab308"
                          onClick={() => setEditingKey(key)}
                        >
                          Edit
                        </Button>
                      </div>
                      <Button
                        variant="tertiary"
                        className="text-xs shrink-0"
                        svg={Trash2}
                        padding="px-2 py-1"
                        color="red"
                        onClick={() => setKeyToDelete(key)}
                      />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

      </Drawer>
      <DeleteModal
        isOpen={keyToDelete != null}
        onClose={() => setKeyToDelete(null)}
        onConfirm={handleDeleteConfirm}
        itemName={
          keyToDelete
            ? (OVERLAY_HISTORY_KEY_LABELS as Record<string, string>)[keyToDelete] ?? keyToDelete
            : undefined
        }
        title="Delete history entry"
        message={
          keyToDelete
            ? `Are you sure you want to delete the history for "${(OVERLAY_HISTORY_KEY_LABELS as Record<string, string>)[keyToDelete] ?? keyToDelete}"?`
            : "Are you sure you want to delete this history entry?"
        }
        warningMessage="This will remove all saved values for this field. History will build again as you edit overlays."
      />
    </>
  );
};

export default OverlayHistoryDrawer;
