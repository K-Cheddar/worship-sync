import { useContext, useRef, useState } from "react";
import { FileImage, Film, HardDrive } from "lucide-react";
import Button from "../../components/Button/Button";
import RadioButton, {
  RadioGroup,
} from "../../components/RadioButton/RadioButton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";
import { ControllerInfoContext } from "../../context/controllerInfo";
import { GlobalInfoContext } from "../../context/globalInfo";
import { ToastContext } from "../../context/toastContext";
import type { LocalAssetStoragePolicy, MediaType } from "../../types";
import { getOrCreateDeviceId } from "../../utils/authStorage";
import { getTrustedDeviceLabel } from "../../utils/deviceInfo";
import generateRandomId from "../../utils/generateRandomId";
import {
  buildLocalImageUrl,
  getRememberedLocalImagePolicy,
  readImageDimensions,
  rememberLocalImagePolicy,
  saveLocalImage,
  validateLocalImageFile,
} from "../../utils/localImageAssets";
import { enqueueLocalImageUpload } from "../../utils/localImageUploadQueue";
import {
  buildLocalVideoFileUrl,
  readVideoMetadata,
  saveLocalVideoFile,
  validateLocalVideoFile,
} from "../../utils/localVideoFileAssets";

type LocalMediaImportSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeItemId?: string;
  onImported: (media: MediaType) => void;
};

const LocalMediaImportSheet = ({
  open,
  onOpenChange,
  activeItemId = "",
  onImported,
}: LocalMediaImportSheetProps) => {
  const { churchId = "", uploadPreset = "bpqu4ma5" } =
    useContext(GlobalInfoContext) || {};
  const { isGuestSession = false } = useContext(ControllerInfoContext) || {};
  const toast = useContext(ToastContext);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [policy, setPolicy] = useState<LocalAssetStoragePolicy>(() =>
    isGuestSession ? "local-only" : getRememberedLocalImagePolicy(churchId),
  );
  const [isImporting, setIsImporting] = useState(false);

  const importImage = async (file: File) => {
    const error = validateLocalImageFile(file);
    if (error) throw new Error(error);
    const dimensions = await readImageDimensions(file);
    const assetId = `local_image_${generateRandomId()}`;
    const now = new Date().toISOString();
    const storagePolicy = isGuestSession ? "local-only" : policy;
    await saveLocalImage({
      id: assetId,
      workspaceId: churchId,
      blob: file,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      width: dimensions.width,
      height: dimensions.height,
      createdAt: now,
    });
    const localUrl = buildLocalImageUrl(assetId);
    const media: MediaType = {
      path: "",
      createdAt: now,
      updatedAt: now,
      format: file.type.replace("image/", "") || "image",
      height: dimensions.height,
      width: dimensions.width,
      name: file.name,
      publicId: assetId,
      type: "image",
      id: assetId,
      background: localUrl,
      thumbnail: localUrl,
      source: "local",
      localImage: {
        id: assetId,
        contentRevision: now,
        ownerDeviceId: getOrCreateDeviceId(),
        ownerLabel: getTrustedDeviceLabel(),
        fileName: file.name,
        contentType: file.type,
        storagePolicy,
      },
    };
    onImported(media);
    if (!isGuestSession) rememberLocalImagePolicy(churchId, storagePolicy);
    if (storagePolicy === "local-and-cloud" && churchId) {
      await enqueueLocalImageUpload({
        assetId,
        itemId: activeItemId,
        workspaceId: churchId,
        uploadPreset,
      });
    }
    return storagePolicy;
  };

  const importVideo = async (file: File) => {
    const error = validateLocalVideoFile(file);
    if (error) throw new Error(error);
    const metadata = await readVideoMetadata(file);
    const assetId = `local_video_${generateRandomId()}`;
    const now = new Date().toISOString();
    await saveLocalVideoFile({
      id: assetId,
      workspaceId: churchId,
      blob: file,
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      width: metadata.width,
      height: metadata.height,
      duration: metadata.duration,
      createdAt: now,
    });
    onImported({
      path: "",
      createdAt: now,
      updatedAt: now,
      format: file.type.replace("video/", "") || "video",
      height: metadata.height,
      width: metadata.width,
      name: file.name,
      publicId: assetId,
      type: "video",
      id: assetId,
      background: buildLocalVideoFileUrl(assetId),
      thumbnail: "",
      placeholderImage: "",
      duration: metadata.duration,
      hasAudio: true,
      source: "local",
      localVideoFile: {
        id: assetId,
        contentRevision: now,
        ownerDeviceId: getOrCreateDeviceId(),
        ownerLabel: getTrustedDeviceLabel(),
        fileName: file.name,
        contentType: file.type,
        storagePolicy: "local-only",
        audioEnabled: true,
      },
    });
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setIsImporting(true);
    try {
      if (file.type.startsWith("image/")) {
        const storagePolicy = await importImage(file);
        toast?.showToast(
          storagePolicy === "local-and-cloud"
            ? "Image added to Media. A cloud copy is uploading in the background."
            : "Image added to Media and kept on this device.",
          "success",
        );
      } else {
        await importVideo(file);
        toast?.showToast(
          "Video added to Media and kept on this device.",
          "success",
        );
      }
      onOpenChange(false);
    } catch (error) {
      toast?.showToast(
        error instanceof Error
          ? error.message
          : "The file could not be imported. Try again.",
        "error",
      );
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-lg">
        <SheetHeader>
          <SheetTitle>Import local media</SheetTitle>
          <SheetDescription>
            Keep an image or video on this device, then use the normal Media
            actions to apply it to a slide.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
            className="sr-only"
            aria-label="Local media file"
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
          <Button
            variant="secondary"
            className="w-full justify-center"
            svg={HardDrive}
            disabled={isImporting}
            isLoading={isImporting}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose image or video
          </Button>
          <div className="grid grid-cols-2 gap-3 text-sm text-neutral-300">
            <div className="rounded-md border border-white/10 bg-black/20 p-3">
              <FileImage className="mb-2 size-5 text-cyan-300" aria-hidden />
              PNG, JPEG, WebP, or GIF
            </div>
            <div className="rounded-md border border-white/10 bg-black/20 p-3">
              <Film className="mb-2 size-5 text-cyan-300" aria-hidden />
              MP4, MOV, or WebM
            </div>
          </div>
          <fieldset className="rounded-md border border-white/10 bg-black/20 p-3">
            <legend className="px-1 text-sm font-semibold">
              Image availability
            </legend>
            <RadioGroup
              value={isGuestSession ? "local-only" : policy}
              onValueChange={(value) =>
                setPolicy(
                  value === "local-and-cloud"
                    ? "local-and-cloud"
                    : "local-only",
                )
              }
              className="flex flex-col gap-3"
            >
              <RadioButton
                optionValue="local-only"
                label="This device only"
                helperText="Keep the image offline."
                hideLabelColon
              />
              <RadioButton
                optionValue="local-and-cloud"
                label="This device and Media Library cloud"
                helperText="Keep the local copy and upload a portable copy in the background."
                hideLabelColon
                disabled={isGuestSession}
              />
            </RadioGroup>
            <p className="mt-3 text-xs text-neutral-400">
              This choice is remembered for the next image. Local video files
              remain offline; use Upload files for a cloud video.
            </p>
          </fieldset>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default LocalMediaImportSheet;
