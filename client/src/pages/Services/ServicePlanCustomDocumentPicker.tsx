import { useEffect, useMemo, useRef, useState } from "react";
import FilteredItems from "../../components/FilteredItems/FilteredItems";
import Modal from "../../components/Modal/Modal";
import CreateItem from "../../containers/CreateItem/CreateItem";
import { useDispatch, useSelector } from "../../hooks";
import {
  initialCreateItemState,
  resetCreateItem,
  setCreateItem,
} from "../../store/createItemSlice";
import type { ItemState, ServiceItem } from "../../types";

const FIELD_CLASS = "text-neutral-100";

type ServicePlanCustomDocumentPickerProps = {
  isOpen: boolean;
  onClose: () => void;
  attachedDocumentIds: string[];
  onSelectDocument: (document: ServiceItem) => void;
};

/** Searches the current church's existing custom-item library in attach mode. */
const ServicePlanCustomDocumentPicker = ({
  isOpen,
  onClose,
  attachedDocumentIds,
  onSelectDocument,
}: ServicePlanCustomDocumentPickerProps) => {
  const documents = useSelector((state) => state.allDocs.allFreeFormDocs);
  const dispatch = useDispatch();
  const [searchValue, setSearchValue] = useState("");
  const [showCreateDocument, setShowCreateDocument] = useState(false);
  const [isCreatingDocument, setIsCreatingDocument] = useState(false);
  const createDocumentSurfaceRef = useRef<HTMLDivElement>(null);
  const canAttachCreatedDocumentRef = useRef(isOpen && showCreateDocument);
  canAttachCreatedDocumentRef.current = isOpen && showCreateDocument;
  const attachedIds = useMemo(() => new Set(attachedDocumentIds), [attachedDocumentIds]);
  const availableDocuments = useMemo<ServiceItem[]>(
    () => documents
      .filter((document) =>
        document.type === "free" &&
        Boolean(document._id) &&
        Array.isArray(document.slides) &&
        !attachedIds.has(document._id),
      )
      .map((document) => ({
        _id: document._id,
        name: document.name,
        type: "free",
        listId: document._id,
        background: typeof document.background === "string" ? document.background : "",
      })),
    [attachedIds, documents],
  );

  useEffect(() => {
    if (isOpen) setShowCreateDocument(false);
  }, [isOpen]);

  useEffect(() => {
    canAttachCreatedDocumentRef.current = isOpen && showCreateDocument;
    return () => {
      canAttachCreatedDocumentRef.current = false;
    };
  }, [isOpen, showCreateDocument]);

  const resetAndClose = () => {
    setIsCreatingDocument(false);
    setSearchValue("");
    setShowCreateDocument(false);
    dispatch(resetCreateItem());
    onClose();
  };

  const openCreateDocument = () => {
    dispatch(setCreateItem({
      ...initialCreateItemState,
      name: searchValue.trim(),
      type: "free",
      hasUserSelectedType: true,
    }));
    setShowCreateDocument(true);
  };

  const handleCreated = (document: ItemState) => {
    // A service-plan element or church can change while Pouch creation is
    // pending. Keep the durable library item, but never attach it to a stale plan.
    if (!canAttachCreatedDocumentRef.current) return;
    onSelectDocument(document);
    resetAndClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isCreatingDocument) resetAndClose();
      }}
      title={showCreateDocument ? "Create custom document" : "Add custom document"}
      size={showCreateDocument ? "full" : "2xl"}
      showCloseButton={!isCreatingDocument}
      contentPadding="p-4 pt-0"
      surfaceClassName={
        showCreateDocument ? undefined : "mx-auto w-full max-w-5xl rounded-lg bg-gray-800"
      }
    >
      {showCreateDocument ? (
        <div
          ref={createDocumentSurfaceRef}
          className="flex h-full min-h-0 flex-col gap-3 text-neutral-100"
        >
          <CreateItem
            variant="embedded"
            embeddedType="free"
            title=""
            onCancel={() => setShowCreateDocument(false)}
            onCreated={handleCreated}
            onCreatingChange={setIsCreatingDocument}
            drawerPortalContainer={createDocumentSurfaceRef.current}
          />
        </div>
      ) : (
        <div className="h-[calc(90vh-9rem)] min-h-[28rem] max-h-[52rem] overflow-hidden rounded-md border border-gray-700 bg-gray-950/40 text-neutral-100">
          <FilteredItems
            list={availableDocuments}
            type="free"
            heading="Custom Documents"
            label="custom document"
            isLoading={false}
            allDocs={documents}
            searchValue={searchValue}
            setSearchValue={setSearchValue}
            onAddItem={onSelectDocument}
            addButtonLabel="Attach"
            showDelete={false}
            showCreateAndExternal
            onCreateNew={openCreateDocument}
            searchLabelClassName={FIELD_CLASS}
            searchInputClassName={FIELD_CLASS}
            hideHeading
            className="h-full min-h-0 py-2"
          />
        </div>
      )}
    </Modal>
  );
};

export default ServicePlanCustomDocumentPicker;
