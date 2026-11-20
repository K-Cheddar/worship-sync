import Button from "../../components/Button/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/DropdownMenu";
import { Download, HardDrive, ImageUp, MonitorUp, Plus, Video } from "lucide-react";
import { useOptionalTransfers } from "../../context/transferContext";
import { getMediaTransferOverview } from "../../context/transferModel";
import { MEDIA_LIBRARY_ORIGIN_COLOR_CLASSES } from "./mediaLibraryOrigin";
import { ShowTransfersMenuItem } from "./MediaAddControl";

type MediaSourceAddMenuProps = {
  onAddMedia?: () => void;
  onAddVideoInput?: () => void;
  onAddScreenShare?: () => void;
  onImportFromCanva?: () => void;
  onDownloadVideo?: () => void;
  mediaUploadDisabled?: boolean;
  isGuestSession?: boolean;
};

export const MediaSourceAddMenu = ({
  onAddMedia,
  onAddVideoInput,
  onAddScreenShare,
  onImportFromCanva,
  onDownloadVideo,
  mediaUploadDisabled = false,
  isGuestSession = false,
}: MediaSourceAddMenuProps) => {
  const transferContext = useOptionalTransfers();
  const activeUploads = getMediaTransferOverview(transferContext?.transfers ?? []).activeCount;
  const title = activeUploads ? `Add Media · ${activeUploads} active media transfers` : "Add Media";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="tertiary" svg={Plus} title={title} aria-label="Add media" disabled={mediaUploadDisabled} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ShowTransfersMenuItem />
        {onDownloadVideo ? (
          <DropdownMenuItem disabled={mediaUploadDisabled} onSelect={onDownloadVideo}>
            <Download aria-hidden /> Download Video
          </DropdownMenuItem>
        ) : null}
        {onAddMedia ? (
          <DropdownMenuItem disabled={mediaUploadDisabled} onSelect={onAddMedia}>
            <HardDrive className={MEDIA_LIBRARY_ORIGIN_COLOR_CLASSES.local.icon} /> Add files
          </DropdownMenuItem>
        ) : null}
        {onAddVideoInput ? (
          <DropdownMenuItem disabled={mediaUploadDisabled} onSelect={onAddVideoInput}>
            <Video className={MEDIA_LIBRARY_ORIGIN_COLOR_CLASSES["video-input"].icon} /> Add video input
          </DropdownMenuItem>
        ) : null}
        {onAddScreenShare ? (
          <DropdownMenuItem disabled={mediaUploadDisabled} onSelect={onAddScreenShare}>
            <MonitorUp className={MEDIA_LIBRARY_ORIGIN_COLOR_CLASSES["video-input"].icon} /> Add screen or window
          </DropdownMenuItem>
        ) : null}
        {onImportFromCanva ? (
          <DropdownMenuItem disabled={mediaUploadDisabled || isGuestSession} onSelect={onImportFromCanva}>
            <ImageUp className={MEDIA_LIBRARY_ORIGIN_COLOR_CLASSES.canva.icon} /> Import from Canva
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
