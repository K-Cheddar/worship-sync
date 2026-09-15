import { MonitorUp, Pencil, Video } from "lucide-react";
import cn from "classnames";
import type { LocalVideoInputMediaSource } from "../../types";
import {
  getDefaultLocalVideoInputLabel,
  getLocalVideoInputKindLabel,
  getLocalVideoInputSourceFieldLabel,
  isDesktopCaptureKind,
  resolveLocalVideoInputBinding,
} from "../../utils/localVideoInput";
import Button from "../Button/Button";
import Icon from "../Icon/Icon";

type LocalVideoInputDetailsProps = {
  source: LocalVideoInputMediaSource;
  canEdit: boolean;
  className?: string;
  onEdit?: () => void;
};

const fitLabel = (fit: LocalVideoInputMediaSource["fit"]) =>
  fit === "cover" ? "Fill and crop" : "Fit entire frame";

/**
 * Left-of-preview inspector for slides that use a live video input or share.
 * Edit opens the existing Relink / Choose share again drawer.
 */
const LocalVideoInputDetails = ({
  source,
  canEdit,
  className,
  onEdit,
}: LocalVideoInputDetailsProps) => {
  const kindLabel = getLocalVideoInputKindLabel(source.captureKind);
  const sourceFieldLabel = getLocalVideoInputSourceFieldLabel(
    source.captureKind,
  );
  const name =
    source.label.trim() || getDefaultLocalVideoInputLabel(source.captureKind);
  const binding = resolveLocalVideoInputBinding(source.sourceId);
  let videoInputValue = binding?.deviceLabel?.trim() || "";
  if (!videoInputValue) {
    videoInputValue = isDesktopCaptureKind(source.captureKind)
      ? "Not shared on this computer"
      : "Not linked on this computer";
  }
  const HeaderIcon = isDesktopCaptureKind(source.captureKind)
    ? MonitorUp
    : Video;

  return (
    <section
      className={cn(
        "flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-md border border-gray-600 max-lg:max-h-[25vh]",
        className,
      )}
      data-testid="local-video-input-details"
    >
      <p className="flex shrink-0 items-center justify-center gap-1 border-b border-gray-600 px-2 py-2 text-center text-sm font-semibold">
        <Icon svg={HeaderIcon} color="#93c5fd" />
        {kindLabel}
      </p>
      <div className="scrollbar-variable min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
        <div>
          <p className="text-xs font-medium text-white/55">Name</p>
          <p className="truncate font-medium text-white" title={name}>
            {name}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-white/55">{sourceFieldLabel}</p>
          <p className="truncate text-white" title={videoInputValue}>
            {videoInputValue}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-white/55">Fit</p>
          <p className="text-white">{fitLabel(source.fit)}</p>
        </div>
      </div>
      {canEdit ? (
        <div className="flex shrink-0 justify-center border-t border-gray-600 px-2 py-2">
          <Button
            svg={Pencil}
            variant="secondary"
            className="text-xs"
            iconSize="sm"
            onClick={onEdit}
          >
            Edit
          </Button>
        </div>
      ) : null}
    </section>
  );
};

export default LocalVideoInputDetails;
