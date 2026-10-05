import Input from "../components/Input/Input";
import { useCallback, useRef, useState } from "react";
import { FileText, Minimize2, Trash2, Upload } from "lucide-react";
import { createPortal } from "react-dom";
import Button from "../components/Button/Button";
import Modal from "../components/Modal/Modal";
import { useOverlayPortalContainer } from "../components/FloatingWindow/FloatingWindowPortalContext";
import { uploadChurchResource } from "../api/auth";
import { useNativeFileDrop } from "../containers/Media/useNativeFileDrop";
import { TransferProgress } from "../components/TransferProgress/TransferProgress";
import { useOptionalTransferActions, useOptionalTransfers } from "../context/transferContext";
import type { Transfer } from "../context/transferModel";
import { formatStorageBytes } from "../components/StorageUsage/storageUsageFormatting";
import type { ChurchResource } from "../types/churchResource";

type ResourceUploadStatus = "queued" | "uploading" | "complete" | "error";
type UploadStatus = "idle" | "uploading" | "ready" | "error";

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

const ResourceTransferProgress = ({ transferId, variant }: { transferId: string; variant: "card" | "compact" }) => {
  const transferContext = useOptionalTransfers();
  const transfer = transferContext?.transfers.find((item) => item.id === transferId);
  return transfer ? <TransferProgress transfer={transfer} variant={variant} /> : null;
};

const ResourceUploadDialog = ({ churchId, onResourcesUploaded, triggerLabel = "Upload", open, onOpenChange, showTrigger = true }: ResourceUploadDialogProps) => {
  const overlayPortalContainer = useOverlayPortalContainer();
  const transferContext = useOptionalTransferActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const transferIdRef = useRef<string | null>(null);
  const unregisterTransferActionsRef = useRef<Array<() => void>>([]);
  const handleUploadRef = useRef<() => void>(() => undefined);
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setIsOpen = (nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMinimizedToButton, setIsMinimizedToButton] = useState(false);
  const [files, setFiles] = useState<PendingResource[]>([]);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState("");

  const isUploading = uploadStatus === "uploading";
  const hasFailedFiles = files.some((file) => file.status === "error");

  const updateFile = useCallback((index: number, update: Partial<PendingResource>) => {
    setFiles((current) => current.map((file, fileIndex) => fileIndex === index ? { ...file, ...update } : file));
  }, []);

  const addFiles = useCallback((newFiles: File[]) => {
    if (isUploading || newFiles.length === 0) return;
    setFiles((current) => [
      ...current,
      ...newFiles.map((file) => ({ file, name: file.name, status: "queued" as const })),
    ]);
    setError("");
  }, [isUploading]);

  const { isFileDragOver, fileDropHandlers } = useNativeFileDrop({
    disabled: isUploading,
    onFiles: addFiles,
  });

  const reset = () => {
    if (isUploading) return;
    setFiles([]);
    setError("");
    setUploadStatus("idle");
    setIsMinimized(false);
    setIsMinimizedToButton(false);
    setIsOpen(false);
    const transfer = transferContext?.getTransfer(transferIdRef.current || "");
    if (transfer) transferContext?.updateTransfer({ ...transfer, actions: [{ key: "dismiss", label: "Dismiss" }] });
    unregisterTransferActionsRef.current.forEach((unregister) => unregister());
    unregisterTransferActionsRef.current = [];
    transferIdRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleUpload = async () => {
    if (isUploading || files.length === 0) return;
    if (uploadStatus !== "error") {
      unregisterTransferActionsRef.current.forEach((unregister) => unregister());
      unregisterTransferActionsRef.current = [];
      transferIdRef.current = null;
    }
    const transferId = transferIdRef.current || `resource-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    transferIdRef.current = transferId;
    if (!unregisterTransferActionsRef.current.length && transferContext?.registerTransferAction) {
      const registeredHandlers: Array<() => void> = [];
      registeredHandlers.push(transferContext.registerTransferAction(transferId, "retry-failed", () => handleUploadRef.current()));
      registeredHandlers.push(transferContext.registerTransferAction(transferId, "dismiss", () => {
        registeredHandlers.forEach((unregister) => unregister());
        if (transferIdRef.current === transferId) {
          unregisterTransferActionsRef.current = [];
          transferIdRef.current = null;
        }
        transferContext.removeTransfer(transferId);
      }));
      unregisterTransferActionsRef.current = registeredHandlers;
    }
    const publishTransfer = (transfer: Transfer) => transferContext?.updateTransfer(transfer);
    setUploadStatus("uploading");
    setError("");
    setIsMinimized(true);
    setIsOpen(false);
    const uploaded: ChurchResource[] = [];
    let failed = 0;
    const batchFiles = files.map((file) => ({ ...file }));
    let completedFiles = batchFiles.filter((file) => file.status === "complete").length;
    const transferName = files.length === 1 ? files[0].name : `${files.length} resources`;
    publishTransfer({ id: transferId, type: "Resource upload", name: transferName, status: "active", progress: 0, phase: { key: "uploading", label: "Uploading resources", current: 0, total: files.length } });

    for (let index = 0; index < batchFiles.length; index += 1) {
      const pending = batchFiles[index];
      if (pending.status === "complete") continue;
      batchFiles[index] = { ...pending, status: "uploading", error: undefined };
      updateFile(index, { status: "uploading", error: undefined });
      const progressBase = completedFiles;
      try {
        const resource = await uploadChurchResource({
          churchId,
          file: pending.file,
          name: pending.name,
          onProgress: (progress) => {
            const overall = ((progressBase + progress / 100) / files.length) * 100;
            publishTransfer({ id: transferId, type: "Resource upload", name: transferName, status: "active", progress: overall, phase: { key: "uploading", label: `Uploading ${index + 1} of ${files.length}`, current: index + 1, total: files.length }, detail: pending.name });
          },
        });
        uploaded.push(resource);
        batchFiles[index] = { ...batchFiles[index], status: "complete" };
        updateFile(index, { status: "complete" });
        completedFiles += 1;
      } catch (uploadError) {
        failed += 1;
        const message = uploadError instanceof Error ? uploadError.message : "Upload failed";
        batchFiles[index] = { ...batchFiles[index], status: "error", error: message };
        updateFile(index, { status: "error", error: message });
      }
    }

    if (uploaded.length) onResourcesUploaded(uploaded);
    if (failed) {
      setUploadStatus("error");
      setError(`${failed} ${failed === 1 ? "file" : "files"} failed to upload. Retry to try again.`);
      const terminalStatus: Transfer["status"] = uploaded.length > 0 || completedFiles > 0 ? "partial" : "failed";
      const failedDetails = batchFiles.filter((file) => file.status === "error").map((file) => `${file.name}: ${file.error || "Upload failed."}`).join("\n");
      publishTransfer({ id: transferId, type: "Resource upload", name: transferName, status: terminalStatus, progress: (completedFiles / files.length) * 100, phase: { key: terminalStatus, label: terminalStatus === "partial" ? "Upload completed with errors" : "Upload failed" }, detail: `${completedFiles} of ${files.length} files uploaded`, error: { message: failedDetails || `${failed} ${failed === 1 ? "file" : "files"} failed to upload.` }, actions: [{ key: "retry-failed", label: "Retry failed files" }, { key: "dismiss", label: "Dismiss" }] });
    } else {
      unregisterTransferActionsRef.current[0]?.();
      unregisterTransferActionsRef.current = unregisterTransferActionsRef.current.slice(1);
      publishTransfer({ id: transferId, type: "Resource upload", name: transferName, status: "complete", progress: 100, phase: { key: "complete", label: "Upload complete" }, detail: `${files.length} ${files.length === 1 ? "file" : "files"} uploaded`, actions: [{ key: "dismiss", label: "Dismiss" }] });
      setUploadStatus("ready");
      setFiles([]);
      setUploadStatus("idle");
      setIsMinimized(false);
      setIsMinimizedToButton(false);
      setIsOpen(false);
    }
  };
  handleUploadRef.current = () => { void handleUpload(); };

  const updateName = (index: number, name: string) => updateFile(index, { name });
  const removeFile = (index: number) => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  const confirmDisabled = files.length === 0 || isUploading || files.some((file) => !file.name.trim());

  return (
    <>
      {!isOpen && isMinimized && !isMinimizedToButton ? createPortal(
        <div className="pointer-events-auto fixed bottom-1 right-4 z-10 min-w-[320px] max-w-[400px] rounded-lg border border-gray-600 bg-gray-800 p-4 shadow-2xl">
          <div className="flex items-center justify-between gap-2">
            <ResourceTransferProgress transferId={transferIdRef.current || "resource-upload"} variant="compact" />
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
        busy={isUploading}
        headerAction={isUploading ? <Button type="button" variant="tertiary" svg={Minimize2} aria-label="Minimize upload" onClick={() => { setIsMinimized(true); setIsMinimizedToButton(false); setIsOpen(false); }} /> : undefined}
      >
        <div className="flex flex-col gap-4">
          <input ref={inputRef} type="file" multiple aria-label="Select resource files" className="hidden" onChange={(event) => addFiles(Array.from(event.target.files || []))} disabled={isUploading} />
          <div {...fileDropHandlers} className={`relative flex flex-col items-center gap-2 rounded border border-dashed p-4 ${isFileDragOver ? "border-cyan-400 bg-cyan-500/10" : "border-gray-600"}`}>
            {isFileDragOver ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded bg-cyan-950/80 text-sm font-semibold text-cyan-100">Drop files to add resources</div> : null}
            <FileText className="size-8 text-cyan-300" aria-hidden />
            <p className="text-sm text-gray-300">Choose one or more files, or drag them here.</p>
            <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={isUploading}>Choose files</Button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto scrollbar-variable">
            {files.length === 0 ? <p className="text-center text-sm text-gray-500">No files selected.</p> : null}
            {files.map((pending, index) => (
              <div key={`${pending.file.name}-${index}`} className="rounded border border-gray-700 bg-gray-950/40 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {!isUploading ? <Input aria-label={`Resource name for ${pending.file.name}`} value={pending.name} onChange={(value) => updateName(index, String(value))} inputClassName="w-full truncate rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100" /> : <p className="truncate text-sm text-gray-100">{pending.name}</p>}
                    <p className="truncate text-xs text-gray-500">Source: {pending.file.name} - {formatStorageBytes(pending.file.size)}</p>
                  </div>
                  {!isUploading ? <div className="flex shrink-0 gap-1"><Button type="button" variant="tertiary" svg={Trash2} aria-label={`Remove ${pending.file.name}`} onClick={() => removeFile(index)} /></div> : null}
                </div>
                {pending.error ? <p className="mt-2 text-xs text-red-300">{pending.error}</p> : null}
              </div>
            ))}
          </div>
          {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}
          {uploadStatus !== "idle" ? <ResourceTransferProgress transferId={transferIdRef.current || "resource-upload"} variant="card" /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={reset} disabled={isUploading}>{uploadStatus === "ready" || uploadStatus === "error" ? "Done" : "Cancel"}</Button>
            <Button type="button" variant="cta" svg={Upload} onClick={() => void handleUpload()} disabled={confirmDisabled}>{hasFailedFiles ? "Retry failed" : `Upload${files.length > 1 ? ` (${files.length} files)` : ""}`}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default ResourceUploadDialog;
