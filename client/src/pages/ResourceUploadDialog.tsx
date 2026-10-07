import { useCallback, useEffect, useRef, useState } from "react";
import { Minimize2, Upload } from "lucide-react";
import { createPortal } from "react-dom";
import Button from "../components/Button/Button";
import Modal from "../components/Modal/Modal";
import { useOverlayPortalContainer } from "../components/FloatingWindow/FloatingWindowPortalContext";
import { useNativeFileDrop } from "../containers/Media/useNativeFileDrop";
import { TransferProgress } from "../components/TransferProgress/TransferProgress";
import { useOptionalTransferActions, useOptionalTransfers } from "../context/transferContext";
import type { ChurchResource } from "../types/churchResource";
import SelectedUploadFileRow from "../components/SelectedUploadFileRow";

type ResourceUploadStatus = "queued" | "uploading" | "complete" | "error";

type PendingResource = {
  file: File;
  name: string;
  status: ResourceUploadStatus;
  error?: string;
};

type ResourceUploadDialogProps = {
  churchId: string;
  onResourcesUploaded: (resources: ChurchResource[]) => void;
  triggerLabel?: string;
  /** Expanded dialog visibility; minimized uploads continue while closed. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
};

const controllerElement = () => document.getElementById("controller-main") || document.body;

const RESOURCE_UPLOAD_ACCEPT = [
  ".pdf", ".txt", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".mp3", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif",
  "application/pdf", "text/plain", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "audio/mpeg", "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
].join(",");
const RESOURCE_UPLOAD_EXTENSIONS = new Set([
  "pdf", "txt", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "mp3", "jpg", "jpeg", "png", "gif", "webp", "avif",
]);
const RESOURCE_UPLOAD_TYPES = new Set([
  "application/pdf", "text/plain", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "audio/mpeg", "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
]);

const isSupportedResourceFile = (file: File) => {
  const extension = file.name.toLowerCase().split(".").pop() || "";
  const contentType = file.type.toLowerCase();
  return RESOURCE_UPLOAD_TYPES.has(contentType) || (
    (!contentType || contentType === "application/octet-stream") && RESOURCE_UPLOAD_EXTENSIONS.has(extension)
  );
};

const ResourceTransferProgress = ({ transferId, variant }: { transferId: string; variant: "card" | "compact" }) => {
  const transferContext = useOptionalTransfers();
  const transfer = transferContext?.transfers.find((item) => item.id === transferId);
  return transfer ? <TransferProgress transfer={transfer} variant={variant} /> : null;
};

const ResourceUploadDialog = ({ churchId, onResourcesUploaded, triggerLabel = "Upload", open, onOpenChange, showTrigger = true }: ResourceUploadDialogProps) => {
  const overlayPortalContainer = useOverlayPortalContainer();
  const transferContext = useOptionalTransferActions();
  const transfersContext = useOptionalTransfers();
  const inputRef = useRef<HTMLInputElement>(null);
  const [transferId, setTransferId] = useState<string | null>(null);
  const listenerCleanupRef = useRef<(() => void) | null>(null);
  const onResourcesUploadedRef = useRef(onResourcesUploaded);
  onResourcesUploadedRef.current = onResourcesUploaded;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setIsOpen = useCallback((nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [open, onOpenChange]);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMinimizedToButton, setIsMinimizedToButton] = useState(false);
  const [files, setFiles] = useState<PendingResource[]>([]);
  const [error, setError] = useState("");

  const transfer = transfersContext?.transfers.find((item) => item.id === transferId);
  const isUploading = transfer?.status === "active";
  const isRetryingExistingBatch = Boolean(
    transferId && (transfer?.status === "failed" || transfer?.status === "partial"),
  );
  const isBatchLocked = isUploading || isRetryingExistingBatch;
  const displayFiles = files.map((file, index) => {
    const status = transfer?.files?.[index]?.status;
    return {
      ...file,
      status: status === "complete" ? "complete" as const : status === "failed" ? "error" as const : status === "active" ? "uploading" as const : file.status,
      error: transfer?.files?.[index]?.error || file.error,
    };
  });
  const hasFailedFiles = displayFiles.some((file) => file.status === "error");
  const uploadError = error || (hasFailedFiles ? transfer?.error?.message || "Some files failed to upload." : "");

  useEffect(() => () => listenerCleanupRef.current?.(), []);
  useEffect(() => {
    if (!transferId || transfer?.status !== "complete") return;
    setFiles([]);
    setError("");
    setIsMinimized(false);
    setIsMinimizedToButton(false);
    setIsOpen(false);
    setTransferId(null);
    listenerCleanupRef.current?.();
    listenerCleanupRef.current = null;
  }, [setIsOpen, transferId, transfer?.status]);

  const updateFile = useCallback((index: number, update: Partial<PendingResource>) => {
    setFiles((current) => current.map((file, fileIndex) => fileIndex === index ? { ...file, ...update } : file));
  }, []);

  const addFiles = useCallback((newFiles: File[]) => {
    if (isBatchLocked || newFiles.length === 0) return;
    const supportedFiles = newFiles.filter(isSupportedResourceFile);
    const unsupportedFiles = newFiles.filter((file) => !isSupportedResourceFile(file));
    if (unsupportedFiles.length) {
      setError(`${unsupportedFiles.map((file) => file.name).join(", ")}: Choose a JPEG, PNG, GIF, WebP, AVIF, PDF, text, Office, or MP3 file.`);
    } else {
      setError("");
    }
    if (!supportedFiles.length) return;
    setFiles((current) => [
      ...current,
      ...supportedFiles.map((file) => ({ file, name: file.name, status: "queued" as const })),
    ]);
  }, [isBatchLocked]);

  const { isFileDragOver, fileDropHandlers } = useNativeFileDrop({
    disabled: isBatchLocked,
    onFiles: addFiles,
  });

  const reset = () => {
    if (isUploading) return;
    setFiles([]);
    setError("");
    setIsMinimized(false);
    setIsMinimizedToButton(false);
    setIsOpen(false);
    listenerCleanupRef.current?.();
    listenerCleanupRef.current = null;
    setTransferId(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleUpload = () => {
    if (isUploading) return;
    if (hasFailedFiles && transferId) {
      void transferContext?.runTransferAction(transferId, "retry-failed");
      return;
    }
    if (files.length === 0 || !transferContext?.startResourceUpload) return;
    const nextTransferId = `resource-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setTransferId(nextTransferId);
    listenerCleanupRef.current?.();
    listenerCleanupRef.current = transferContext.registerResourceUploadListener(
      nextTransferId,
      (resources) => onResourcesUploadedRef.current(resources),
    );
    setError("");
    setIsMinimized(true);
    setIsOpen(false);
    transferContext.startResourceUpload({
      id: nextTransferId,
      churchId,
      files: files.map(({ file, name }) => ({ file, name })),
    });
  };

  const updateName = (index: number, name: string) => updateFile(index, { name });
  const removeFile = (index: number) => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  const confirmDisabled = files.length === 0 || isUploading || files.some((file) => !file.name.trim());

  return (
    <>
      {!isOpen && isMinimized && !isMinimizedToButton ? createPortal(
        <div className="pointer-events-auto fixed bottom-1 right-4 z-10 min-w-[320px] max-w-[400px] rounded-lg border border-gray-600 bg-gray-800 p-4 shadow-2xl">
          <div className="flex items-center justify-between gap-2">
            <ResourceTransferProgress transferId={transferId || "resource-upload"} variant="compact" />
            <div className="flex shrink-0 gap-1">
              <Button variant="tertiary" onClick={() => { setIsMinimized(false); setIsOpen(true); }} aria-label="Restore resource upload">Restore</Button>
              <Button variant="tertiary" onClick={() => setIsMinimizedToButton(true)} aria-label="Minimize resource upload to button">Minimize</Button>
            </div>
          </div>
        </div>,
        overlayPortalContainer ?? controllerElement(),
      ) : null}
      {showTrigger || (!isOpen && isMinimizedToButton) ? <Button type="button" variant="cta" svg={Upload} onClick={() => { setIsOpen(true); setIsMinimized(false); setIsMinimizedToButton(false); }}>
        {isUploading ? "Uploading..." : triggerLabel}
      </Button> : null}
      <Modal
        isOpen={isOpen}
        onClose={reset}
        title="Upload resources"
        size="md"
        contentClassName="flex flex-col overflow-hidden"
        busy={isUploading}
        headerAction={isUploading ? <Button type="button" variant="tertiary" svg={Minimize2} aria-label="Minimize upload" onClick={() => { setIsMinimized(true); setIsMinimizedToButton(false); setIsOpen(false); }} /> : undefined}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <input ref={inputRef} type="file" multiple accept={RESOURCE_UPLOAD_ACCEPT} aria-label="Select resource files" className="hidden" onChange={(event) => addFiles(Array.from(event.target.files || []))} disabled={isBatchLocked} />
          <div
            {...fileDropHandlers}
            role="group"
            aria-label="Resource file drop zone"
            className={[
              "relative flex shrink-0 rounded border border-dashed transition-colors",
              files.length > 0 ? "flex-row flex-wrap items-center justify-between gap-2 p-2" : "flex-col items-center gap-2 p-4",
              isFileDragOver ? "border-cyan-400 bg-cyan-500/10" : "border-gray-600",
            ].join(" ")}
          >
            {isFileDragOver ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded bg-cyan-950/80 text-sm font-semibold text-cyan-100">Drop files to add resources</div> : null}
            {files.length > 0 ? <p className="text-sm text-gray-300">{isRetryingExistingBatch ? "Retry uses this batch’s original files and names." : "Drop more files here"}</p> : <>
              <Upload className="size-8 text-cyan-300" aria-hidden="true" />
              <p className="text-sm text-gray-300">Drop files here or choose files</p>
              <p className="text-xs text-gray-500">Images, documents, and MP3 audio</p>
            </>}
            <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={isBatchLocked}>{files.length > 0 ? "Add files" : "Choose files"}</Button>
          </div>
          {displayFiles.length === 0 ? <p className="shrink-0 text-center text-sm text-gray-500">No files selected.</p> : (
            <div role="region" aria-label="Selected resource files" tabIndex={0} className="min-h-0 max-h-[min(50vh,32rem)] flex-1 space-y-2 overflow-y-auto scrollbar-variable">
              {displayFiles.map((pending, index) => (
                <SelectedUploadFileRow
                  key={pending.file.name + "-" + index}
                  file={pending.file}
                  displayName={pending.name}
                  visualType={pending.file.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(pending.file.name) ? "image" : "file"}
                  editable={!isBatchLocked}
                  onRename={(name) => updateName(index, name)}
                  onRemove={() => removeFile(index)}
                  error={pending.error}
                />
              ))}
            </div>
          )}
          {uploadError ? <p className="shrink-0 text-sm text-red-300" role="alert">{uploadError}</p> : null}
          {transfer?.status === "active" ? <div className="shrink-0"><ResourceTransferProgress transferId={transferId || "resource-upload"} variant="card" /></div> : null}
          <div className="flex shrink-0 justify-end gap-2">
            <Button type="button" variant="secondary" onClick={reset} disabled={isUploading}>{hasFailedFiles ? "Done" : "Cancel"}</Button>
            <Button type="button" variant="cta" svg={Upload} onClick={handleUpload} disabled={confirmDisabled}>{hasFailedFiles ? "Retry failed" : files.length > 1 ? "Upload (" + files.length + " files)" : "Upload"}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default ResourceUploadDialog;
