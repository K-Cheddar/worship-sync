import { useCallback, useEffect, useMemo, useState } from "react";
import Drawer from "../../components/Drawer";
import DisplayWindow from "../../components/DisplayWindow/DisplayWindow";
import Modal from "../../components/Modal/Modal";
import { Plus, Trash2, Search, MoreVertical, X } from "lucide-react";
import { getAllOverlayDocs, getOverlayUsageByList } from "../../utils/dbUtils";
import { DBOverlay, OverlayInfo, OverlayType } from "../../types";
import { getDefaultFormatting } from "../../utils/overlayUtils";
import { cn } from "../../utils/cnHelper";
import {
  overlayBorderColorMap,
  overlayTextColorMap,
  overlayTypeLabelMap,
} from "../../utils/itemTypeMaps";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import DeleteModal from "../../components/Modal/DeleteModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/DropdownMenu";
import {
  Select as RadixSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/Select";
import { useDispatch, useSelector } from "../../hooks";
import { RootState } from "../../store/store";
import generateRandomId from "../../utils/generateRandomId";
import { addExistingOverlayToList, updateList } from "../../store/overlaysSlice";

type AddExistingOverlayDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  db: PouchDB.Database | null | undefined;
  currentListIds: string[];
  selectedOverlayId: string | undefined;
  onAddToOverlayList: (overlay: OverlayInfo) => void;
  isMobile: boolean;
};

const overlayBaseClass = "flex items-center h-full text-wrap text-center";

const TYPE_ORDER: (OverlayType | undefined)[] = [
  "participant",
  "stick-to-bottom",
  "qr-code",
  "image",
];

const getOverlaySortLabel = (o: DBOverlay): string => {
  const t = o.type || "participant";
  switch (t) {
    case "participant":
      return (o.name || o.title || o.event || "").toLowerCase();
    case "stick-to-bottom":
      return (o.heading || o.subHeading || "").toLowerCase();
    case "qr-code":
      return (o.description || o.url || "").toLowerCase();
    case "image":
      return (o.name || o.imageUrl || "").toLowerCase();
    default:
      return (o.name || o.heading || o.description || "").toLowerCase();
  }
}

const TYPE_FILTER_ALL = "all";

const TYPE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: TYPE_FILTER_ALL, label: "All types" },
  { value: "participant", label: overlayTypeLabelMap.get("participant")! },
  { value: "stick-to-bottom", label: overlayTypeLabelMap.get("stick-to-bottom")! },
  { value: "qr-code", label: overlayTypeLabelMap.get("qr-code")! },
  { value: "image", label: overlayTypeLabelMap.get("image")! },
];

const getOverlayType = (o: DBOverlay): string => {
  return o.type || "participant";
};

const DISPLAY_WINDOW_OVERLAY_KEYS: Record<
  string,
  "participantOverlayInfo" | "stbOverlayInfo" | "qrCodeOverlayInfo" | "imageOverlayInfo"
> = {
  participant: "participantOverlayInfo",
  "stick-to-bottom": "stbOverlayInfo",
  "qr-code": "qrCodeOverlayInfo",
  image: "imageOverlayInfo",
};

const toOverlayInfo = (overlay: DBOverlay): OverlayInfo => {
  const type = getOverlayType(overlay);
  return {
    ...overlay,
    formatting: {
      ...getDefaultFormatting(type),
      ...overlay.formatting,
    },
  };
}

const getOverlayDisplayName = (o: DBOverlay): string => {
  return o.name || o.event || o.heading || o.id;
};

async function createOverlayCopyInDb(
  overlay: DBOverlay,
  db: PouchDB.Database
): Promise<{ normalized: OverlayInfo; newDoc: DBOverlay } | null> {
  const newId = generateRandomId();
  const { _id: _omitId, _rev: _omitRev, ...rest } = overlay;
  const doc = {
    _id: `overlay-${newId}`,
    ...rest,
    id: newId,
  };
  try {
    const result = await db.put(
      doc as PouchDB.Core.PutDocument<DBOverlay>
    );
    const newDoc = { ...doc, _rev: result.rev } as DBOverlay;
    const normalized = { ...toOverlayInfo(overlay), id: newId };
    return { normalized, newDoc };
  } catch (e) {
    console.error("Failed to create overlay copy", e);
    return null;
  }
}

const getDisplayListNames = (
  overlayId: string,
  inList: boolean,
  selectedListName: string | undefined,
  listNamesMap: Map<string, string[]>
): string[] => {
  const raw = listNamesMap.get(overlayId) ?? [];
  // Don't show current outline in the list unless overlay is actually in it
  // (fixes stale display after removing overlay from outline)
  let names = raw.filter((name) => name !== selectedListName || inList);
  if (inList && selectedListName && !names.includes(selectedListName)) {
    names = [...names, selectedListName];
  }
  return names;
};

const OverlayDetailContent = ({ overlay }: { overlay: DBOverlay }) => {
  const hasData =
    (overlay.type === "participant" &&
      (overlay.name || overlay.title || overlay.event)) ||
    (overlay.type === "stick-to-bottom" &&
      (overlay.heading || overlay.subHeading)) ||
    (overlay.type === "qr-code" &&
      (overlay.description || overlay.url)) ||
    (overlay.type === "image" && (overlay.imageUrl || overlay.name));

  return (
    <div className="flex flex-col flex-1 min-w-0 gap-0.5 text-left">
      {overlay.type === "participant" && (
        <>
          {overlay.name && (
            <span className={cn(overlayBaseClass, "text-base justify-start")}>
              {overlay.name}
            </span>
          )}
          {overlay.title && (
            <span
              className={cn(overlayBaseClass, "text-sm italic justify-start")}
            >
              {overlay.title}
            </span>
          )}
          {overlay.event && (
            <span className={cn(overlayBaseClass, "text-sm justify-start")}>
              {overlay.event}
            </span>
          )}
        </>
      )}
      {overlay.type === "stick-to-bottom" && (
        <>
          {overlay.heading && (
            <span className={cn(overlayBaseClass, "text-sm justify-start")}>
              {overlay.heading}
            </span>
          )}
          {overlay.subHeading && (
            <span className={cn(overlayBaseClass, "text-sm justify-start")}>
              {overlay.subHeading}
            </span>
          )}
        </>
      )}
      {overlay.type === "qr-code" && (
        <>
          {overlay.description && (
            <span className={cn(overlayBaseClass, "text-sm justify-start")}>
              {overlay.description.split("\n")[0]}
            </span>
          )}
        </>
      )}
      {overlay.type === "image" && (
        <>
          {overlay.name && (
            <span className={cn(overlayBaseClass, "text-sm justify-start")}>
              {overlay.name}
            </span>
          )}
        </>
      )}
      {!hasData && (
        <span className={cn(overlayBaseClass, "text-sm justify-start")}>
          Empty overlay
        </span>
      )}
    </div>
  );
}

const AddExistingOverlayDrawer = ({
  isOpen,
  onClose,
  db,
  currentListIds,
  selectedOverlayId,
  onAddToOverlayList,
  isMobile,
}: AddExistingOverlayDrawerProps) => {
  const dispatch = useDispatch();
  const currentOverlayList = useSelector(
    (state: RootState) => state.undoable.present.overlays.list
  );
  const selectedList = useSelector(
    (state: RootState) => state.undoable.present.itemLists.selectedList
  );

  const [overlays, setOverlays] = useState<DBOverlay[]>([]);
  const [overlayListNames, setOverlayListNames] = useState<Map<string, string[]>>(
    () => new Map()
  );
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(TYPE_FILTER_ALL);
  const [isLoading, setIsLoading] = useState(false);
  const [overlayToDelete, setOverlayToDelete] = useState<DBOverlay | null>(null);
  const [previewOverlay, setPreviewOverlay] = useState<DBOverlay | null>(null);
  const [showDeleteAllUnusedModal, setShowDeleteAllUnusedModal] =
    useState(false);
  const [justAddedSourceId, setJustAddedSourceId] = useState<string | null>(null);

  const loadOverlays = useCallback(async () => {
    if (!db) return;
    setIsLoading(true);
    try {
      const [all, usage] = await Promise.all([
        getAllOverlayDocs(db),
        getOverlayUsageByList(db),
      ]);
      setOverlays(all);
      setOverlayListNames(usage);
    } catch (e) {
      console.error("Failed to load overlays", e);
      setOverlays([]);
      setOverlayListNames(new Map());
    } finally {
      setIsLoading(false);
    }
  }, [db]);

  useEffect(() => {
    if (isOpen && db) {
      loadOverlays();
    }
  }, [isOpen, db, loadOverlays]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchValue), 250);
    return () => clearTimeout(t);
  }, [searchValue]);

  const filteredAndSortedOverlays = useMemo(() => {
    let list = overlays;

    if (typeFilter && typeFilter !== TYPE_FILTER_ALL) {
      list = list.filter((o) => getOverlayType(o) === typeFilter);
    }

    const term = debouncedSearch.trim().toLowerCase();
    if (term) {
      list = list.filter((o) => {
        const haystack = [
          o.name,
          o.title,
          o.event,
          o.heading,
          o.subHeading,
          o.description,
          o.url,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(term);
      });
    }

    const typeOrder = (t: string | undefined) => {
      const i = TYPE_ORDER.indexOf(t as OverlayType);
      return i === -1 ? TYPE_ORDER.length : i;
    };

    return [...list].sort((a, b) => {
      const aType = getOverlayType(a);
      const bType = getOverlayType(b);
      const typeDiff = typeOrder(aType) - typeOrder(bType);
      if (typeDiff !== 0) return typeDiff;
      return getOverlaySortLabel(a).localeCompare(getOverlaySortLabel(b));
    });
  }, [overlays, debouncedSearch, typeFilter]);

  const unusedOverlays = useMemo(
    () =>
      overlays.filter((o) => (overlayListNames.get(o.id) ?? []).length === 0),
    [overlays, overlayListNames]
  );
  const unusedCount = unusedOverlays.length;

  const confirmDelete = async () => {
    if (!db || !overlayToDelete) return;
    const toDelete = overlayToDelete;
    setOverlayToDelete(null);
    try {
      await db.remove(toDelete);
      setOverlays((prev) => prev.filter((o) => o._id !== toDelete._id));
      const updatedList = currentOverlayList.filter((o) => o.id !== toDelete.id);
      if (updatedList.length !== currentOverlayList.length) {
        dispatch(updateList(updatedList));
      }
    } catch (e) {
      console.error("Failed to delete overlay", toDelete._id, e);
    }
  };

  const confirmDeleteAllUnused = async () => {
    if (!db || unusedCount === 0) return;
    setShowDeleteAllUnusedModal(false);
    const idsToRemove = new Set(unusedOverlays.map((o) => o.id));
    try {
      for (const o of unusedOverlays) {
        await db.remove(o);
      }
      setOverlays((prev) => prev.filter((o) => !idsToRemove.has(o.id)));
      setOverlayListNames((prev) => {
        const next = new Map(prev);
        idsToRemove.forEach((id) => next.delete(id));
        return next;
      });
      const updatedList = currentOverlayList.filter((o) => !idsToRemove.has(o.id));
      if (updatedList.length !== currentOverlayList.length) {
        dispatch(updateList(updatedList));
      }
    } catch (e) {
      console.error("Failed to delete unused overlays", e);
    }
  };

  const handleAddToList = async (overlay: DBOverlay) => {
    if (!db) return;
    const isUnused =
      (overlayListNames.get(overlay.id) ?? []).length === 0;

    let normalized: OverlayInfo;
    if (isUnused) {
      normalized = toOverlayInfo(overlay);
    } else {
      const copyResult = await createOverlayCopyInDb(overlay, db);
      if (!copyResult) return;
      normalized = copyResult.normalized;
      setOverlays((prev) => [...prev, copyResult.newDoc]);
      if (selectedList?.name) {
        setOverlayListNames((prev) => {
          const next = new Map(prev);
          const names = next.get(copyResult.newDoc.id) ?? [];
          if (!names.includes(selectedList.name)) {
            next.set(copyResult.newDoc.id, [...names, selectedList.name]);
          }
          return next;
        });
      }
    }

    dispatch(
      addExistingOverlayToList({
        overlay: normalized,
        insertAfterId: selectedOverlayId,
      })
    );
    onAddToOverlayList(normalized);
    setJustAddedSourceId(overlay.id);
    setTimeout(() => setJustAddedSourceId(null), 2000);
  };

  const renderListContent = () => {
    if (isLoading) return <p className="text-sm text-gray-400">Loading overlays...</p>;
    if (filteredAndSortedOverlays.length === 0) return <p className="text-sm text-gray-400">No overlays found. Try a different search or type filter.</p>;
    return (
      <ul className="scrollbar-variable flex flex-col gap-2 overflow-y-auto flex-1 min-h-0">
        {filteredAndSortedOverlays.map((overlay, index) => {
          const inList = currentListIds.includes(overlay.id);
          const overlayType = getOverlayType(overlay);
          const listNames = getDisplayListNames(
            overlay.id,
            inList,
            selectedList?.name,
            overlayListNames
          );
          const rowBg = index % 2 === 0 ? "bg-gray-800" : "bg-gray-600";
          const borderColor =
            overlayBorderColorMap.get(overlayType) ?? "border-l-gray-500";
          const typeTextColor =
            overlayTextColorMap.get(overlayType) ?? "text-gray-400";
          const typeLabel =
            overlayTypeLabelMap.get(overlayType) ?? overlayType;
          let addButtonLabel: string;
          if (justAddedSourceId === overlay.id) addButtonLabel = "Added";
          else addButtonLabel = "Add to list";

          return (
            <li
              key={overlay.id}
              role="button"
              tabIndex={0}
              className={cn(
                "flex rounded-lg overflow-clip leading-3 px-2 py-1.5 shrink-0 border border-transparent border-l-4 hover:border-gray-300 cursor-pointer",
                rowBg,
                borderColor,
                isMobile ? "flex-col gap-1.5" : "items-center gap-2"
              )}
              onClick={() => setPreviewOverlay(overlay)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setPreviewOverlay(overlay);
                }
              }}
            >
              {isMobile ? (
                <>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        "text-xs shrink-0 w-24 capitalize font-medium flex-1",
                        typeTextColor
                      )}
                      title={overlayType}
                    >
                      {typeLabel}
                    </span>
                    <span
                      className="text-xs text-gray-300 shrink-0 min-w-0 truncate"
                      title={listNames.length ? listNames.join(", ") : undefined}
                    >
                      {listNames.length ? `In: ${listNames.join(", ")}` : "Not in any list"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex flex-col flex-1 min-w-0 gap-0.5 text-left">
                      <OverlayDetailContent overlay={overlay} />
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="tertiary"
                        className="text-xs"
                        svg={Plus}
                        padding="px-2 py-1"
                        color="#22d3ee"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToList(overlay);
                        }}
                        disabled={justAddedSourceId === overlay.id}
                      >
                        {addButtonLabel}
                      </Button>
                      <Button
                        variant="tertiary"
                        className="text-xs"
                        svg={Trash2}
                        padding="px-2 py-1"
                        color="red"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOverlayToDelete(overlay);
                        }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <span
                    className={cn(
                      "text-xs shrink-0 w-24 capitalize font-medium",
                      typeTextColor
                    )}
                    title={overlayType}
                  >
                    {typeLabel}
                  </span>
                  <div className="flex flex-col flex-1 min-w-0 gap-0.5 text-left">
                    <OverlayDetailContent overlay={overlay} />
                  </div>
                  <span
                    className="text-xs text-gray-300 shrink-0 max-w-[140px] truncate"
                    title={listNames.length ? listNames.join(", ") : undefined}
                  >
                    {listNames.length ? `In: ${listNames.join(", ")}` : "Not in any list"}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="tertiary"
                      className="text-xs"
                      svg={Plus}
                      padding="px-2 py-1"
                      color="#22d3ee"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToList(overlay);
                      }}
                      disabled={justAddedSourceId === overlay.id}
                    >
                      {addButtonLabel}
                    </Button>
                    <Button
                      variant="tertiary"
                      className="text-xs"
                      svg={Trash2}
                      padding="px-2 py-1"
                      color="red"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOverlayToDelete(overlay);
                      }}
                    />
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Existing overlays"
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
              placeholder="Search overlays..."
              hideLabel
              svgAction={searchValue ? () => setSearchValue("") : undefined}
              svg={searchValue ? X : Search}
            />
            <RadixSelect
              value={typeFilter}
              onValueChange={setTypeFilter}
            >
              <SelectTrigger
                className="w-40 bg-gray-700 text-white text-sm"
                chevronColor="text-white"
              >
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent
                className="bg-gray-800 border-gray-600"
                contentBackgroundColor="bg-gray-800"
                contentTextColor="text-white"
              >
                {TYPE_FILTER_OPTIONS.map((opt) => {
                  const textColor =
                    opt.value === TYPE_FILTER_ALL
                      ? "text-gray-200"
                      : overlayTextColorMap.get(opt.value) ?? "text-gray-400";
                  return (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className={cn("font-medium", textColor)}>
                        {opt.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </RadixSelect>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="tertiary"
                  className="text-xs"
                  svg={MoreVertical}
                  padding="px-2 py-1"
                  aria-label="More actions"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="bg-gray-800 text-white border-gray-600"
                align="end"
              >
                <DropdownMenuItem
                  variant="destructive"
                  disabled={unusedCount === 0}
                  onClick={() => setShowDeleteAllUnusedModal(true)}
                >
                  Delete all unused ({unusedCount})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {renderListContent()}
      </div>

      <DeleteModal
        isOpen={!!overlayToDelete}
        onClose={() => setOverlayToDelete(null)}
        onConfirm={confirmDelete}
        itemName={overlayToDelete ? getOverlayDisplayName(overlayToDelete) : undefined}
        warningMessage="This will permanently delete the overlay. Outlines that reference it will no longer load it."
        confirmText="Delete overlay"
      />
      <Modal
        isOpen={!!previewOverlay}
        onClose={() => setPreviewOverlay(null)}
        size="lg"
        contentPadding="p-1"
        zIndexLevel={2}
      >
        {previewOverlay && (
          <div className="bg-gray-600 rounded-lg overflow-hidden">
            <DisplayWindow
              showBorder
              displayType="stream"
              className="w-full aspect-video"
              {...{
                [DISPLAY_WINDOW_OVERLAY_KEYS[getOverlayType(previewOverlay)] ??
                  "participantOverlayInfo"]: toOverlayInfo(previewOverlay),
              }}
            />
          </div>
        )}
      </Modal>
      <DeleteModal
        isOpen={showDeleteAllUnusedModal}
        onClose={() => setShowDeleteAllUnusedModal(false)}
        onConfirm={confirmDeleteAllUnused}
        message="Delete all overlays that are not in any list"
        itemName={
          unusedCount > 0 ? `${unusedCount} overlay(s)` : undefined
        }
        warningMessage="This will permanently delete these overlays."
        confirmText="Delete all unused"
      />
    </Drawer>
  );
};

export default AddExistingOverlayDrawer;
