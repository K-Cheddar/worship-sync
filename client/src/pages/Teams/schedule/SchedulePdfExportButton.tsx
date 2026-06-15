import { useEffect, useState } from "react";
import { Download, Printer } from "lucide-react";
import Button from "../../../components/Button/Button";
import SegmentedControl from "../../../components/SegmentedControl/SegmentedControl";
import Modal from "../../../components/Modal/Modal";
import Spinner from "../../../components/Spinner/Spinner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import type { ScheduleExportModel } from "./scheduleExport";
import {
  buildSchedulePdf,
  downloadSchedulePdf,
  SCHEDULE_EXPORT_LAYOUTS,
  type ScheduleExportLayout,
} from "./scheduleExportPdf";

/**
 * Export-PDF control with a live preview (the actual rendered PDF) and Download.
 *
 * Two modes:
 *  - Controlled (`layout` provided, e.g. the public view): the button exports
 *    the currently-selected on-screen layout directly — no layout chooser.
 *  - Uncontrolled (admin grid): a popover lets you pick a layout, and the
 *    preview lets you switch between layouts before downloading.
 */
const SchedulePdfExportButton = ({
  model,
  disabled,
  buttonVariant = "secondary",
  layout,
}: {
  model: ScheduleExportModel | null;
  disabled?: boolean;
  buttonVariant?: "secondary" | "tertiary";
  layout?: ScheduleExportLayout;
}) => {
  const controlled = layout != null;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pickedLayout, setPickedLayout] = useState<ScheduleExportLayout>("grid");
  const [previewUrl, setPreviewUrl] = useState("");
  const activeLayout = layout ?? pickedLayout;

  useEffect(() => {
    if (!previewOpen || !model) {
      setPreviewUrl("");
      return;
    }
    let url = "";
    try {
      const blob = buildSchedulePdf(model, activeLayout).output("blob");
      url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch {
      setPreviewUrl("");
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [previewOpen, activeLayout, model]);

  const exportButton = (
    <Button
      variant={buttonVariant}
      svg={Printer}
      iconSize="sm"
      disabled={disabled || !model}
      onClick={controlled ? () => setPreviewOpen(true) : undefined}
    >
      {controlled ? "Save as PDF" : "Export PDF"}
    </Button>
  );

  return (
    <>
      {controlled ? (
        exportButton
      ) : (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>{exportButton}</PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Choose a layout
            </p>
            {SCHEDULE_EXPORT_LAYOUTS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="tertiary"
                padding="px-2 py-1.5"
                className="w-full justify-start rounded text-sm font-normal"
                onClick={() => {
                  setPopoverOpen(false);
                  setPickedLayout(option.value);
                  setPreviewOpen(true);
                }}
              >
                {option.label}
              </Button>
            ))}
          </PopoverContent>
        </Popover>
      )}

      <Modal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="PDF preview"
        size="full"
        headerAction={
          <div className="mr-2 flex flex-wrap items-center gap-2">
            {controlled ? null : (
              <SegmentedControl
                ariaLabel="PDF layout"
                variant="compact"
                value={pickedLayout}
                onChange={setPickedLayout}
                options={SCHEDULE_EXPORT_LAYOUTS}
              />
            )}
            <Button
              variant="secondary"
              svg={Download}
              iconSize="sm"
              disabled={!model}
              onClick={() => {
                if (model) downloadSchedulePdf(model, activeLayout);
              }}
            >
              Download
            </Button>
          </div>
        }
      >
        {previewUrl ? (
          <iframe
            title="Schedule PDF preview"
            src={previewUrl}
            className="h-[78vh] w-full rounded border border-gray-700 bg-white"
          />
        ) : (
          <div className="flex h-[78vh] items-center justify-center">
            <Spinner />
          </div>
        )}
      </Modal>
    </>
  );
};

export default SchedulePdfExportButton;
