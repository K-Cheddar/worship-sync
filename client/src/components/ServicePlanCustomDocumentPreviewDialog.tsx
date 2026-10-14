import { useState, type ReactNode } from "react";
import Modal from "./Modal/Modal";
import StaticSlideThumbnail from "../containers/ItemSlides/StaticSlideThumbnail";
import { useStaticThumbnailScaleFactor } from "../containers/ItemSlides/staticThumbnailGeometry";
import type { DBItem } from "../types";

type ServicePlanCustomDocumentPreviewDialogProps = {
  document: DBItem | null;
  unavailableName?: string;
  onClose: () => void;
};

const ServicePlanCustomDocumentPreviewDialog = ({
  document,
  unavailableName,
  onClose,
}: ServicePlanCustomDocumentPreviewDialogProps) => {
  const [slidesContainer, setSlidesContainer] = useState<HTMLDivElement | null>(null);
  const isAvailableCustomDocument = document?.type === "free";
  const title = (isAvailableCustomDocument ? document.name : "") ||
    unavailableName ||
    "Custom document";
  const slides = isAvailableCustomDocument && Array.isArray(document.slides)
    ? document.slides
    : [];
  const scaleFactor = useStaticThumbnailScaleFactor(
    slidesContainer,
    1,
    `${document?._id || "custom-document"}:${slides.length}`,
  );
  let previewContent: ReactNode;
  if (!isAvailableCustomDocument) {
    previewContent = (
      <p className="py-8 text-center text-sm text-gray-300" role="status">
        This custom document is no longer available in the library.
      </p>
    );
  } else if (slides.length) {
    previewContent = (
      <div
        ref={setSlidesContainer}
        className="space-y-4 overflow-y-auto"
        aria-label={`${title} slides`}
      >
        {slides.map((slide, index) => (
          <figure key={slide.id || index} className="mx-auto w-full max-w-4xl">
            <StaticSlideThumbnail
              slide={slide}
              itemType="free"
              isStreamFormat={false}
              scaleFactor={scaleFactor}
            />
            <figcaption className="mt-1 text-xs text-gray-400">
              {slide.name?.trim() || `Slide ${index + 1}`}
            </figcaption>
          </figure>
        ))}
      </div>
    );
  } else {
    previewContent = (
      <p className="py-8 text-center text-sm text-gray-300">
        This document has no slides to preview.
      </p>
    );
  }

  if (!document && !unavailableName) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={title}
      description={isAvailableCustomDocument
        ? "Read-only preview of the custom document slides."
        : "This custom document is no longer available in the library."}
      size="xl"
      contentPadding="p-3 sm:p-5"
    >
      {previewContent}
    </Modal>
  );
};

export default ServicePlanCustomDocumentPreviewDialog;
