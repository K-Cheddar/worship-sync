import { useMemo, useState } from "react";
import FilteredItems from "../../components/FilteredItems/FilteredItems";
import Modal from "../../components/Modal/Modal";
import { useSelector } from "../../hooks";
import type { ServiceItem } from "../../types";

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
  const [searchValue, setSearchValue] = useState("");
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add custom document"
      size="2xl"
      contentPadding="p-4 pt-0"
      surfaceClassName="mx-auto w-full max-w-5xl rounded-lg bg-gray-800"
    >
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
          showCreateAndExternal={false}
          searchLabelClassName={FIELD_CLASS}
          searchInputClassName={FIELD_CLASS}
          hideHeading
          className="h-full min-h-0 py-2"
        />
      </div>
    </Modal>
  );
};

export default ServicePlanCustomDocumentPicker;
