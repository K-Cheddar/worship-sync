import { useCallback, useRef, useState } from "react";
import { FileText, Minimize2, Trash2, Upload } from "lucide-react";
import { createPortal } from "react-dom";
import Button from "../components/Button/Button";
import Modal from "../components/Modal/Modal";
import { uploadChurchResource } from "../api/auth";
import { useNativeFileDrop } from "../containers/Media/useNativeFileDrop";
import { ProgressPopup } from "../containers/Media/components/ProgressPopup";
import type { ChurchResource } from "../types/churchResource";

type ResourceUploadStatus = "queued" | "uploading" | "complete" | "error";
type UploadStatus = "idle" | "uploading" | "ready" | "error";

type PendingResource = {
  file: File;
  name: string;
  status: ResourceUploadStatus;
  progress: number;
  error?: string;
};

type ResourceUploadDialogProps = {
  churchId: string;
  onResourcesUploaded: (resources: ChurchResource[]) => void;
};

const controllerElement = () => document.getElementById("controller-main") || document.body;

const ResourceUploadDialog = ({ churchId, onResourcesUploaded }: ResourceUploadDialogProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMinimizedToButton, setIsMinimizedToButton] = useState(false);
  const [files, setFiles] = useState<PendingResource[]>([]);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [overallProgress, setOverallProgress] = useState(0);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
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
      ...newFiles.map((file) => ({ file, name: file.name, status: "queued" as const, progress: 0 })),
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
    setStatusMessage("");
    setOverallProgress(0);
    setUploadStatus("idle");
    setCurrentFileIndex(0);
    setIsMinimized(false);
    setIsMinimizedToButton(false);
    setIsOpen(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleUpload = async () => {
    if (isUploading || files.length === 0) return;
    setUploadStatus("uploading");
    setError("");
    setIsMinimized(true);
    const uploaded: ChurchResource[] = [];
    let failed = 0;
    let completedFiles = files.filter((file) => file.status === "complete").length;

    for (let index = 0; index < files.length; index += 1) {
      const pending = files[index];
      if (pending.status === "complete") continue;
      setCurrentFileIndex(index);
      updateFile(index, { status: "uploading", progress: 0, error: undefined });
      setStatusMessage(`Uploading ${index + 1}/${files.length}: ${pending.name}`);
      const progressBase = completedFiles;
      try {
        const resource = await uploadChurchResource({
          churchId,
          file: pending.file,
          name: pending.name,
          onProgress: (progress) => {
            updateFile(index, { progress });
            setOverallProgress(((progressBase + progress / 100) / files.length) * 100);
          },
        });
        uploaded.push(resource);
        updateFile(index, { status: "complete", progress: 100 });
        completedFiles += 1;
        setOverallProgress((completedFiles / files.length) * 100);
      } catch (uploadError) {
        failed += 1;
        updateFile(index, { status: "error", error: uploadError instanceof Error ? uploadError.message : "Upload failed" });
      }
    }

    if (uploaded.length) onResourcesUploaded(uploaded);
    if (failed) {
      setUploadStatus("error");
      setError(`${failed} ${failed === 1 ? "file" : "files"} failed to upload. Retry to try again.`);
      setStatusMessage(`Upload complete. ${files.length - failed} succeeded, ${failed} failed.`);
    } else {
      setUploadStatus("ready");
      setOverallProgress(100);
      setStatusMessage(`All ${files.length} ${files.length === 1 ? "file" : "files"} uploaded.`);
      setFiles([]);
      setStatusMessage("");
      setOverallProgress(0);
      setUploadStatus("idle");
      setIsMinimized(false);
      setIsMinimizedToButton(false);
      setIsOpen(false);
    }
  };

  const updateName = (index: number, name: string) => updateFile(index, { name });
  const removeFile = (index: number) => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  const confirmDisabled = files.length === 0 || isUploading || files.some((file) => !file.name.trim());

  return (
    <>
      {isMinimized && !isMinimizedToButton ? createPortal(
        <ProgressPopup
          uploadStatus={uploadStatus}
          overallProgress={overallProgress}
          statusMessage={statusMessage}
          currentFileIndex={currentFileIndex}
          totalFiles={files.length}
          onRestore={() => setIsMinimized(false)}
          onMinimize={() => setIsMinimizedToButton(true)}
        />,
        controllerElement(),
      ) : null}
      <Button type="button" variant="cta" svg={Upload} onClick={() => { setIsOpen(true); setIsMinimized(false); setIsMinimizedToButton(false); }}>
        {isUploading ? "Uploading..." : "Upload"}
      </Button>
      <Modal
        isOpen={isOpen && !isMinimized && !isMinimizedToButton}
        onClose={reset}
        title="Upload resources"
        size="md"
        showCloseButton={!isUploading}
        headerAction={isUploading ? <Button type="button" variant="tertiary" svg={Minimize2} aria-label="Minimize upload" onClick={() => setIsMinimized(true)} /> : undefined}
      >
        <div className="flex flex-col gap-4">
          <input ref={inputRef} type="file" multiple aria-label="Select resource files" className="hidden" onChange={(event) => addFiles(Array.from(event.target.files || []))} disabled={isUploading} />
          <div {...fileDropHandlers} className={`relative flex flex-col items-center gap-2 rounded border border-dashed p-4 ${isFileDragOver ? "border-cyan-400 bg-cyan-500/10" : "border-gray-600"}`}>
            {isFileDragOver ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded bg-cyan-950/80 text-sm font-semibold text-cyan-100">Drop files to add resources</div> : null}
            <FileText className="size-8 text-cyan-300" aria-hidden />
            <p className="text-sm text-gray-300">Choose one or more files, or drag them here.</p>
            <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={isUploading}>Choose files</Button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {files.length === 0 ? <p className="text-center text-sm text-gray-500">No files selected.</p> : null}
            {files.map((pending, index) => (
              <div key={`${pending.file.name}-${index}`} className="rounded border border-gray-700 bg-gray-950/40 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {!isUploading ? <input aria-label={`Resource name for ${pending.file.name}`} value={pending.name} onChange={(event) => updateName(index, event.target.value)} className="w-full truncate rounded border border-gray-600 bg-gray-900 px-2 py-1 text-sm text-gray-100" /> : <p className="truncate text-sm text-gray-100">{pending.name}</p>}
                    <p className="truncate text-xs text-gray-500">Source: {pending.file.name} - {(pending.file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  {!isUploading ? <div className="flex shrink-0 gap-1"><Button type="button" variant="tertiary" svg={Trash2} aria-label={`Remove ${pending.file.name}`} onClick={() => removeFile(index)} /></div> : null}
                </div>
                {pending.status === "uploading" ? <div className="mt-2 h-1.5 rounded bg-gray-700"><div className="h-1.5 rounded bg-cyan-500" style={{ width: `${pending.progress}%` }} /></div> : null}
                {pending.status === "complete" ? <p className="mt-1 text-xs text-green-300">Complete</p> : null}
                {pending.status === "error" ? <p className="mt-1 text-xs text-red-300">{pending.error || "Upload failed"}</p> : null}
              </div>
            ))}
          </div>
          {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}
          {uploadStatus !== "idle" ? <p className="text-sm text-gray-300" role="status">{statusMessage} ({Math.round(overallProgress)}%)</p> : null}
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
