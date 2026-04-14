import { useCallback, useEffect, useMemo, useState } from "react";
import Drawer from "../../components/Drawer";
import { Plus, Trash2, Search, MoreVertical, X } from "lucide-react";
import Menu from "../../components/Menu/Menu";
import {
  getAllCreditDocsForOutline,
  getCreditUsageByList,
} from "../../utils/dbUtils";
import {
  DBCredit,
  DBCredits,
  CreditsInfo,
  getCreditsDocId,
} from "../../types";
import { cn } from "../../utils/cnHelper";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import DeleteModal from "../../components/Modal/DeleteModal";
import { useDispatch, useSelector } from "../../hooks";
import { addCredit, deleteCredit } from "../../store/creditsSlice";
import { broadcastCreditsUpdate, RootState } from "../../store/store";

type ExistingCreditsDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  db: PouchDB.Database | null | undefined;
  outlineId: string | undefined;
  currentListIds: string[];
  isMobile: boolean;
};

const toCreditsInfo = (doc: DBCredit): CreditsInfo => ({
  id: doc.id,
  heading: doc.heading ?? "",
  text: doc.text ?? "",
  hidden: doc.hidden,
});

const getCreditSortLabel = (c: DBCredit): string =>
  (c.heading || c.text || c.id).toLowerCase();

const getCreditDisplayName = (c: DBCredit): string =>
  c.heading?.trim() || c.text?.trim().split("\n")[0] || c.id;

/** Same idea as ExistingOverlaysDrawer: avoid stale "current list" after local edits. */
const getDisplayListNames = (
  creditId: string,
  inList: boolean,
  selectedListName: string | undefined,
  listNamesMap: Map<string, string[]>,
): string[] => {
  const raw = listNamesMap.get(creditId) ?? [];
  let names = raw.filter((name) => name !== selectedListName || inList);
  if (inList && selectedListName && !names.includes(selectedListName)) {
    names = [...names, selectedListName];
  }
  return names;
};

const ExistingCreditsDrawer = ({
  isOpen,
  onClose,
  db,
  outlineId,
  currentListIds,
  isMobile,
}: ExistingCreditsDrawerProps) => {
  const dispatch = useDispatch();
  const selectedList = useSelector(
    (state: RootState) => state.undoable.present.itemLists.selectedList,
  );
  const [credits, setCredits] = useState<DBCredit[]>([]);
  const [creditListNames, setCreditListNames] = useState<
    Map<string, string[]>
  >(() => new Map());
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [creditToDelete, setCreditToDelete] = useState<DBCredit | null>(null);
  const [showDeleteAllUnusedModal, setShowDeleteAllUnusedModal] =
    useState(false);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  const loadCredits = useCallback(async () => {
    if (!db || !outlineId) return;
    setIsLoading(true);
    try {
      const [all, usage] = await Promise.all([
        getAllCreditDocsForOutline(db, outlineId),
        getCreditUsageByList(db),
      ]);
      setCredits(all);
      setCreditListNames(usage);
    } catch (e) {
      console.error("Failed to load credits", e);
      setCredits([]);
      setCreditListNames(new Map());
    } finally {
      setIsLoading(false);
    }
  }, [db, outlineId]);

  useEffect(() => {
    if (isOpen && db && outlineId) {
      loadCredits();
    }
  }, [isOpen, db, outlineId, loadCredits]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchValue), 250);
    return () => clearTimeout(t);
  }, [searchValue]);

  const filteredAndSortedCredits = useMemo(() => {
    let list = credits;
    const term = debouncedSearch.trim().toLowerCase();
    if (term) {
      list = list.filter((c) => {
        const haystack = [c.heading, c.text, c.id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(term);
      });
    }
    return [...list].sort((a, b) => {
      const diff = getCreditSortLabel(a).localeCompare(getCreditSortLabel(b));
      return diff !== 0 ? diff : a.id.localeCompare(b.id);
    });
  }, [credits, debouncedSearch]);

  const unusedCredits = useMemo(
    () => credits.filter((c) => !currentListIds.includes(c.id)),
    [credits, currentListIds],
  );
  const unusedCount = unusedCredits.length;

  const confirmDelete = async () => {
    if (!db || !creditToDelete || !outlineId) return;
    const toDelete = creditToDelete;
    setCreditToDelete(null);
    try {
      const existingCredits: DBCredits = await db.get(
        getCreditsDocId(outlineId),
      );
      const hadInIndex = existingCredits.creditIds.includes(toDelete.id);
      if (hadInIndex) {
        existingCredits.creditIds = existingCredits.creditIds.filter(
          (x) => x !== toDelete.id,
        );
        existingCredits.updatedAt = new Date().toISOString();
        await db.put(existingCredits);
        broadcastCreditsUpdate([existingCredits]);
      }

      const creditDoc = await db.get(toDelete._id);
      await db.remove(creditDoc);

      setCredits((prev) => prev.filter((c) => c._id !== toDelete._id));

      if (currentListIds.includes(toDelete.id)) {
        dispatch(deleteCredit(toDelete.id));
      }

      setCreditListNames((prev) => {
        const next = new Map(prev);
        next.delete(toDelete.id);
        return next;
      });
    } catch (e) {
      console.error("Failed to delete credit doc", toDelete._id, e);
    }
  };

  const confirmDeleteAllUnused = async () => {
    if (!db || !outlineId || unusedCount === 0) return;
    setShowDeleteAllUnusedModal(false);
    const toRemove = [...unusedCredits];
    const removeLogicalIds = new Set(toRemove.map((c) => c.id));

    try {
      const existingCredits: DBCredits = await db.get(
        getCreditsDocId(outlineId),
      );
      const hadAnyInIndex = existingCredits.creditIds.some((id) =>
        removeLogicalIds.has(id),
      );
      if (hadAnyInIndex) {
        existingCredits.creditIds = existingCredits.creditIds.filter(
          (x) => !removeLogicalIds.has(x),
        );
        existingCredits.updatedAt = new Date().toISOString();
        await db.put(existingCredits);
        broadcastCreditsUpdate([existingCredits]);
      }

      for (const c of toRemove) {
        const doc = await db.get(c._id);
        await db.remove(doc);
      }

      const removedDocIds = new Set(toRemove.map((c) => c._id));
      setCredits((prev) => prev.filter((c) => !removedDocIds.has(c._id)));

      setCreditListNames((prev) => {
        const next = new Map(prev);
        for (const id of removeLogicalIds) {
          next.delete(id);
        }
        return next;
      });
    } catch (e) {
      console.error("Failed to delete unused credits", e);
    }
  };

  const handleAddToList = (credit: DBCredit) => {
    if (currentListIds.includes(credit.id)) return;
    dispatch(addCredit(toCreditsInfo(credit)));
    setJustAddedId(credit.id);
    const listName = selectedList?.name;
    if (listName) {
      setCreditListNames((prev) => {
        const next = new Map(prev);
        const cur = next.get(credit.id) ?? [];
        if (!cur.includes(listName)) {
          next.set(credit.id, [...cur, listName]);
        }
        return next;
      });
    }
    setTimeout(() => setJustAddedId(null), 2000);
  };

  const renderListContent = () => {
    if (isLoading)
      return (
        <p className="text-sm text-gray-400">Loading credits...</p>
      );
    if (filteredAndSortedCredits.length === 0) {
      return (
        <p className="text-sm text-gray-400">
          No credits found. Try a different search.
        </p>
      );
    }
    return (
      <ul className="scrollbar-variable flex flex-col gap-2 overflow-y-auto flex-1 min-h-0">
        {filteredAndSortedCredits.map((credit, index) => {
          const inList = currentListIds.includes(credit.id);
          const listNames = getDisplayListNames(
            credit.id,
            inList,
            selectedList?.name,
            creditListNames,
          );
          const listLabel =
            listNames.length > 0
              ? `In: ${listNames.join(", ")}`
              : "Not in any list";
          const rowBg = index % 2 === 0 ? "bg-gray-800" : "bg-gray-600";
          const addLabel =
            justAddedId === credit.id ? "Added" : "Add to list";

          return (
            <li
              key={credit._id}
              className={cn(
                "flex rounded-lg overflow-clip leading-snug px-2 py-1.5 shrink-0 border border-transparent border-l-4 border-l-cyan-600 hover:border-gray-300",
                rowBg,
                isMobile ? "flex-col gap-1.5" : "items-center gap-2",
              )}
            >
              {isMobile ? (
                <>
                  <div className="flex items-center justify-between gap-2 shrink-0 w-full">
                    <span
                      className="text-xs text-gray-300 truncate min-w-0"
                      title={
                        listNames.length
                          ? listNames.join(", ")
                          : "Not in any credits list"
                      }
                    >
                      {listLabel}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="tertiary"
                        className="text-xs"
                        svg={Plus}
                        padding="px-2 py-1"
                        color="#22d3ee"
                        onClick={() => handleAddToList(credit)}
                        disabled={inList || justAddedId === credit.id}
                      >
                        {addLabel}
                      </Button>
                      <Button
                        variant="tertiary"
                        className="text-xs"
                        svg={Trash2}
                        padding="px-2 py-1"
                        color="red"
                        onClick={() => setCreditToDelete(credit)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5 text-left min-w-0 w-full">
                    <span className="text-sm font-medium text-white truncate">
                      {credit.heading?.trim() || "(No heading)"}
                    </span>
                    <span className="text-xs text-gray-300 line-clamp-3 whitespace-pre-wrap">
                      {credit.text || "—"}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col flex-1 min-w-0 gap-0.5 text-left">
                    <span className="text-sm font-medium text-white truncate">
                      {credit.heading?.trim() || "(No heading)"}
                    </span>
                    <span className="text-xs text-gray-300 line-clamp-2 whitespace-pre-wrap">
                      {credit.text || "—"}
                    </span>
                  </div>
                  <span
                    className="text-xs text-gray-300 shrink-0 max-w-[min(200px,28vw)] truncate"
                    title={
                      listNames.length
                        ? listNames.join(", ")
                        : "Not in any credits list"
                    }
                  >
                    {listLabel}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="tertiary"
                      className="text-xs"
                      svg={Plus}
                      padding="px-2 py-1"
                      color="#22d3ee"
                      onClick={() => handleAddToList(credit)}
                      disabled={inList || justAddedId === credit.id}
                    >
                      {addLabel}
                    </Button>
                    <Button
                      variant="tertiary"
                      className="text-xs"
                      svg={Trash2}
                      padding="px-2 py-1"
                      color="red"
                      onClick={() => setCreditToDelete(credit)}
                    />
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Existing credits"
      size="xl"
      position={isMobile ? "bottom" : "right"}
      closeOnEscape
      contentClassName="flex flex-col min-h-0"
      contentPadding="p-0"
    >
      <div className="flex flex-col flex-1 min-h-0 p-4 gap-4">
        <div className="flex flex-col gap-2 shrink-0">
          <div className="flex flex-wrap items-end gap-2">
            <Input
              label="Search"
              className="flex-1 min-w-[120px]"
              value={searchValue}
              onChange={(val) => setSearchValue((val as string) ?? "")}
              placeholder="Search credits..."
              hideLabel
              svgAction={searchValue ? () => setSearchValue("") : undefined}
              svg={searchValue ? X : Search}
              svgActionAriaLabel={searchValue ? "Clear search" : undefined}
            />
            <Menu
              menuItems={[
                {
                  text: `Delete all unused (${unusedCount})`,
                  variant: "destructive",
                  disabled: unusedCount === 0,
                  onClick: () => setShowDeleteAllUnusedModal(true),
                },
              ]}
              TriggeringButton={
                <Button
                  variant="tertiary"
                  className="text-xs"
                  svg={MoreVertical}
                  padding="px-2 py-1"
                  aria-label="More actions"
                />
              }
            />
          </div>
        </div>

        {renderListContent()}
      </div>

      <DeleteModal
        isOpen={!!creditToDelete}
        onClose={() => setCreditToDelete(null)}
        onConfirm={confirmDelete}
        itemName={
          creditToDelete ? getCreditDisplayName(creditToDelete) : undefined
        }
        warningMessage="This permanently deletes this credit. Outlines that include it in their credits list will no longer show it."
        confirmText="Delete credit"
      />
      <DeleteModal
        isOpen={showDeleteAllUnusedModal}
        onClose={() => setShowDeleteAllUnusedModal(false)}
        onConfirm={confirmDeleteAllUnused}
        message="Delete all credits not in this outline's list"
        itemName={unusedCount > 0 ? `${unusedCount} credit(s)` : undefined}
        warningMessage="This permanently deletes orphaned credit rows for this outline."
        confirmText="Delete all unused"
      />
    </Drawer>
  );
};

export default ExistingCreditsDrawer;
