import { useState } from "react";
import Modal from "../../components/Modal/Modal";
import StaticSlideThumbnail from "../../containers/ItemSlides/StaticSlideThumbnail";
import { useStaticThumbnailScaleFactor } from "../../containers/ItemSlides/staticThumbnailGeometry";
import type { DBItem } from "../../types";

type ServicePlanCustomDocumentPreviewDialogProps = {
  document: DBItem | null;
  onClose: () => void;
};

const ServicePlanCustomDocumentPreviewDialog = ({
  document,
  onClose,
}: ServicePlanCustomDocumentPreviewDialogProps) => {
  const [slidesContainer, setSlidesContainer] = useState<HTMLDivElement | null>(null);
  const slides = document?.type === "free" && Array.isArray(document.slides)
    ? document.slides
    : [];
  const scaleFactor = useStaticThumbnailScaleFactor(
    slidesContainer,
    1,
    `${document?._id || "custom-document"}:${slides.length}`,
  );

  if (!document) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={document.name || "Custom document"}
      description="Read-only preview of the custom document slides."
      size="xl"
      contentPadding="p-3 sm:p-5"
    >
      {slides.length ? (
        <div
          ref={setSlidesContainer}
          className="space-y-4 overflow-y-auto"
          aria-label={`${document.name || "Custom document"} slides`}
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
      ) : (
        <p className="py-8 text-center text-sm text-gray-300">
          This document has no slides to preview.
        </p>
      )}
    </Modal>
  );
};

export default ServicePlanCustomDocumentPreviewDialog;
