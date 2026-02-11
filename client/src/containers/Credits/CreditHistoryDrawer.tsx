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
  deleteCreditsHistoryEntry,
  updateCreditsHistoryEntry,
} from "../../store/creditsSlice";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { putCreditHistoryDoc, removeCreditHistoryDoc } from "../../utils/dbUtils";
import { cn } from "../../utils/cnHelper";

type CreditHistoryDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  position?: "left" | "right" | "top" | "bottom";
};

const CreditHistoryDrawer = ({ isOpen, onClose, size = "lg", position = "right" }: CreditHistoryDrawerProps) => {
  const dispatch = useDispatch();
  const { db } = useContext(ControllerInfoContext) ?? {};
  const creditsHistory = useSelector(
    (state: RootState) => state.undoable.present.credits.creditsHistory
  );
  const [headingToDelete, setHeadingToDelete] = useState<string | null>(null);
  const [editingDrafts, setEditingDrafts] = useState<Record<string, string>>({});
  const [editingHeading, setEditingHeading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const entries = useMemo(
    () =>
      Object.entries(creditsHistory)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([heading, lines]) => {
          const q = searchQuery.trim().toLowerCase();
          if (!q) return true;
          if (heading.toLowerCase().includes(q)) return true;
          return lines.some((l) => l.toLowerCase().includes(q));
        }),
    [creditsHistory, searchQuery]
  );

  const handleDeleteConfirm = async () => {
    if (headingToDelete == null) return;
    dispatch(deleteCreditsHistoryEntry(headingToDelete));
    if (db) {
      removeCreditHistoryDoc(db, headingToDelete).catch(console.error);
    }
    setHeadingToDelete(null);
  };

  const handleSaveItem = useCallback(
    (heading: string) => {
      const draft = editingDrafts[heading];
      const currentLines = creditsHistory[heading] ?? [];
      const newLines =
        draft !== undefined
          ? draft
            .split(/\n/)
            .map((s) => s.trim())
            .filter(Boolean)
          : currentLines;
      if (JSON.stringify(newLines) !== JSON.stringify(currentLines)) {
        dispatch(updateCreditsHistoryEntry({ heading, lines: newLines }));
        if (db) {
          putCreditHistoryDoc(db, heading, newLines).catch(console.error);
        }
      }
      setEditingDrafts((prev) => {
        const next = { ...prev };
        delete next[heading];
        return next;
      });
      setEditingHeading(null);
    },
    [dispatch, db, editingDrafts, creditsHistory]
  );

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title="Credit history"
        position={position}
        size={size}
        contentClassName="overflow-auto flex-1 min-h-0 flex flex-col text-white"
      >
        <p className="text-sm text-gray-400 pb-2">Suggestions are based on the history of published credits.</p>
        <div className="flex flex-col gap-2 p-2 shrink-0 border-b border-gray-700">
          <Input
            label="Search"
            className="flex-1 min-w-[120px]"
            value={searchQuery}
            onChange={(val) => setSearchQuery((val as string) ?? "")}
            placeholder="Search by heading or content..."
            hideLabel
            svgAction={searchQuery ? () => setSearchQuery("") : undefined}
            svg={searchQuery ? X : Search}
          />
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-gray-400 p-2">
            {Object.keys(creditsHistory).length === 0
              ? "History is built when you publish credits. Publish your credits list to start building history per heading."
              : "No history entries match your search."}
          </p>
        ) : (
          <ul className="scrollbar-thin flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 p-2">
            {entries.map(([heading, lines], index) => {
              const isEditing = editingHeading === heading;
              const draftText = editingDrafts[heading] ?? lines.join("\n");
              const effectiveLines =
                editingDrafts[heading] !== undefined
                  ? draftText
                    .split(/\n/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                  : lines;
              const lineCount = effectiveLines.length;
              const rowBg = index % 2 === 0 ? "bg-gray-800" : "bg-gray-600";
              return (
                <li
                  key={heading}
                  className={cn(
                    "flex flex-col rounded-lg overflow-clip border border-gray-600 px-2 py-1.5 gap-1.5",
                    rowBg
                  )}
                >
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <span
                      className="text-sm font-medium truncate"
                      title={heading}
                    >
                      {heading} - History
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {lineCount} {lineCount === 1 ? "line" : "lines"}
                    </span>
                  </div>
                  {isEditing ? (
                    <TextArea
                      label="History lines"
                      hideLabel
                      value={draftText}
                      onChange={(eOrVal) => {
                        const s =
                          typeof eOrVal === "string"
                            ? eOrVal
                            : (eOrVal as FormEvent<HTMLTextAreaElement>)
                              .currentTarget.value;
                        setEditingDrafts((prev) => ({
                          ...prev,
                          [heading]: s,
                        }));
                      }}
                      autoResize
                      className="min-w-0"
                      textareaClassName="text-xs text-gray-300 bg-gray-900/50 border border-gray-600 rounded px-2 py-1 min-h-[2rem] resize-none"
                    />
                  ) : (
                    <div className="text-xs text-gray-300 wrap-break-word min-w-0 flex flex-col gap-0.5">
                      {lines.map((line, i) => (
                        <div key={i}>{line}</div>
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
                          onClick={() => handleSaveItem(heading)}
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
                              delete next[heading];
                              return next;
                            });
                            setEditingHeading(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="tertiary"
                          className="text-xs"
                          svg={Pencil}
                          padding="px-2 py-1"
                          color="#eab308"
                          onClick={() => {
                            setEditingHeading(heading);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="tertiary"
                          className="text-xs shrink-0"
                          svg={Trash2}
                          padding="px-2 py-1"
                          color="red"
                          onClick={() => setHeadingToDelete(heading)}
                        />
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Drawer>
      <DeleteModal
        isOpen={headingToDelete != null}
        onClose={() => setHeadingToDelete(null)}
        onConfirm={handleDeleteConfirm}
        itemName={headingToDelete ? `${headingToDelete} – History` : undefined}
        title="Delete history entry"
        message={
          headingToDelete
            ? `Are you sure you want to delete the history for "${headingToDelete}"?`
            : "Are you sure you want to delete this history entry?"
        }
        warningMessage="This will remove all saved lines for this heading. You can build history again by publishing credits."
      />
    </>
  );
};

export default CreditHistoryDrawer;
