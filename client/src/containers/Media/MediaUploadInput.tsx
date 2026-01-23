import { useState, useRef, useImperativeHandle, forwardRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Upload, Minimize2 } from "lucide-react";
import Button from "../../components/Button/Button";
import Modal from "../../components/Modal/Modal";
import {
  MediaUploadInputProps,
  MediaUploadInputRef,
  FileUploadProgress,
  UploadStatus,
} from "./MediaUploadInput.types";
import { detectFileType, validateFiles } from "./utils/fileUtils";
import { uploadVideoToMux } from "./utils/muxUpload";
import { uploadImageToCloudinary } from "./utils/cloudinaryUpload";
import { FileList } from "./components/FileList";
import { UploadStatusDisplay } from "./components/UploadStatusDisplay";
import { ProgressPopup } from "./components/ProgressPopup";

const MediaUploadInput = forwardRef<MediaUploadInputRef, MediaUploadInputProps>(
  ({ onImageComplete, onVideoComplete, showButton = true, uploadPreset = "bpqu4ma5", cloudName = "portable-media" }, ref) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(false);
    const [isMinimizedToButton, setIsMinimizedToButton] = useState(false);
    const [error, setError] = useState("");
    const [selectedFiles, setSelectedFiles] = useState<FileUploadProgress[]>([]);
    const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
    const [overallProgress, setOverallProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState("");
    const [currentFileIndex, setCurrentFileIndex] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cancelRequestedRef = useRef(false);
    const activeXhrRef = useRef<XMLHttpRequest | null>(null);
    const pollingTimeoutsRef = useRef<NodeJS.Timeout[]>([]);

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      if (files.length === 0) return;

      const { valid, invalid } = validateFiles(files);
      if (invalid.length > 0) {
        setError(`Please select valid image or video files. ${invalid.length} invalid ${invalid.length === 1 ? 'file' : 'files'} found.`);
        return;
      }

      const newFiles: FileUploadProgress[] = valid.map((file) => ({
        file,
        fileType: detectFileType(file),
        status: "idle" as UploadStatus,
        progress: 0,
      }));

      setSelectedFiles((prev) => [...prev, ...newFiles]);
      setError("");
    };

    const handleRemoveFile = (index: number) => {
      setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const updateFileStatus = (
      fileIndex: number,
      updates: Partial<FileUploadProgress>
    ) => {
      setSelectedFiles((prev) =>
        prev.map((item, idx) =>
          idx === fileIndex ? { ...item, ...updates } : item
        )
      );
    };

    const uploadSingleFile = async (
      fileProgress: FileUploadProgress,
      fileIndex: number,
      totalFiles: number
    ): Promise<void> => {
      updateFileStatus(fileIndex, { status: "uploading", progress: 0 });
      setStatusMessage(`Uploading ${fileIndex + 1}/${totalFiles}: ${fileProgress.file.name}...`);

      const callbacks = {
        onProgress: (progress: number) => {
          const overallFileProgress =
            (fileIndex / totalFiles) * 100 + (progress * (fileProgress.fileType === "video" ? 0.4 : 1)) / totalFiles;
          updateFileStatus(fileIndex, { progress });
          setOverallProgress(overallFileProgress);
          setStatusMessage(
            `Uploading ${fileIndex + 1}/${totalFiles}: ${fileProgress.file.name}... ${Math.round(progress)}%`
          );
        },
        onStatusUpdate: (message: string) => {
          setStatusMessage(message);
        },
        isCancelled: () => cancelRequestedRef.current,
        setXhr: (xhr: XMLHttpRequest) => {
          activeXhrRef.current = xhr;
        },
        addTimeout: (timeoutId: NodeJS.Timeout) => {
          pollingTimeoutsRef.current.push(timeoutId);
        },
      };

      try {
        if (fileProgress.fileType === "video") {
          updateFileStatus(fileIndex, { status: "processing", progress: 40 });
          const result = await uploadVideoToMux(fileProgress.file, callbacks);
          updateFileStatus(fileIndex, { status: "ready", progress: 100 });
          onVideoComplete(result);
        } else {
          const result = await uploadImageToCloudinary(
            fileProgress.file,
            uploadPreset,
            cloudName,
            callbacks
          );
          updateFileStatus(fileIndex, { status: "ready", progress: 100 });
          onImageComplete(result);
        }

        setOverallProgress(((fileIndex + 1) / totalFiles) * 100);
      } catch (err) {
        updateFileStatus(fileIndex, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
        throw err;
      }
    };

    const handleUpload = async () => {
      if (selectedFiles.length === 0) {
        setError("Please select at least one file");
        return;
      }

      setError("");
      setUploadStatus("uploading");
      setOverallProgress(0);
      setCurrentFileIndex(0);
      setStatusMessage("Starting uploads...");
      setIsMinimized(true);
      cancelRequestedRef.current = false;

      const totalFiles = selectedFiles.length;
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < selectedFiles.length; i++) {
        if (cancelRequestedRef.current) break;

        setCurrentFileIndex(i);
        try {
          await uploadSingleFile(selectedFiles[i], i, totalFiles);
          if (!cancelRequestedRef.current) {
            successCount++;
          }
        } catch (err) {
          if (cancelRequestedRef.current) {
            setSelectedFiles((prev) =>
              prev.map((item, idx) =>
                idx >= i
                  ? { ...item, status: "error" as UploadStatus, error: "Cancelled" }
                  : item
              )
            );
            break;
          }
          errorCount++;
          console.error(`Failed to upload file ${i + 1}:`, err);
        }
      }

      if (cancelRequestedRef.current) {
        setUploadStatus("error");
        setError("Upload cancelled");
        setStatusMessage("Upload was cancelled");
      } else {
        if (errorCount === 0) {
          setUploadStatus("ready");
          setStatusMessage(`All ${successCount} ${successCount === 1 ? 'file' : 'files'} uploaded successfully!`);
        } else if (successCount === 0) {
          setUploadStatus("error");
          setError(`All ${errorCount} ${errorCount === 1 ? 'file' : 'files'} failed to upload`);
        } else {
          setUploadStatus("ready");
          setStatusMessage(`Upload complete! ${successCount} succeeded, ${errorCount} failed.`);
        }

        if (errorCount === 0) {
          setTimeout(() => handleCancel(), 2000);
        }
      }
    };

    const handleCancel = () => {
      if (isUploading) {
        cancelRequestedRef.current = true;
        if (activeXhrRef.current) {
          activeXhrRef.current.abort();
          activeXhrRef.current = null;
        }
        pollingTimeoutsRef.current.forEach(timeoutId => clearTimeout(timeoutId));
        pollingTimeoutsRef.current = [];
        setStatusMessage("Cancelling upload...");
      }
      
      setSelectedFiles([]);
      setError("");
      setUploadStatus("idle");
      setOverallProgress(0);
      setStatusMessage("");
      setCurrentFileIndex(0);
      setIsMinimized(false);
      setIsMinimizedToButton(false);
      setIsModalOpen(false);
      cancelRequestedRef.current = false;
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };

    const openModal = () => {
      setIsModalOpen(true);
      setIsMinimized(false);
      setIsMinimizedToButton(false);
    };

    useImperativeHandle(ref, () => ({
      openModal,
      getUploadStatus: () => ({
        isUploading,
        progress: overallProgress,
        status: uploadStatus,
      }),
    }));

    const isUploading = uploadStatus === "uploading" || uploadStatus === "processing";
    const showProgressPopup = (isUploading || uploadStatus === "ready" || uploadStatus === "error") && isMinimized && !isMinimizedToButton;

    useEffect(() => {
      if (isUploading) {
        if (window.electronAPI) {
          window.electronAPI.setUploadInProgress(true);
        }

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
          const message = "You have an active upload in progress. If you leave now, your upload will be cancelled and you may lose progress.";
          e.preventDefault();
          e.returnValue = message;
          return message;
        };

        window.addEventListener("beforeunload", handleBeforeUnload);

        return () => {
          window.removeEventListener("beforeunload", handleBeforeUnload);
          if (window.electronAPI) {
            window.electronAPI.setUploadInProgress(false);
          }
        };
      } else {
        if (window.electronAPI) {
          window.electronAPI.setUploadInProgress(false);
        }
      }
    }, [isUploading]);

    const getControllerElement = () => {
      const controllerMain = document.getElementById("controller-main");
      return controllerMain || document.body;
    };

    const imageCount = selectedFiles.filter(f => f.fileType === "image").length;
    const videoCount = selectedFiles.filter(f => f.fileType === "video").length;

    return (
      <>
        {showButton && (
          <Button
            variant="tertiary"
            svg={Upload}
            onClick={openModal}
            title="Upload Media"
          >
            Add
          </Button>
        )}

        {showProgressPopup && createPortal(
          <ProgressPopup
            uploadStatus={uploadStatus}
            overallProgress={overallProgress}
            statusMessage={statusMessage}
            currentFileIndex={currentFileIndex}
            totalFiles={selectedFiles.length}
            onRestore={() => {
              setIsMinimized(false);
              setIsMinimizedToButton(false);
            }}
            onMinimize={() => {
              setIsMinimizedToButton(true);
              setIsMinimized(false);
            }}
          />,
          getControllerElement()
        )}

        <Modal
          isOpen={isModalOpen && !isMinimized && !isMinimizedToButton}
          onClose={handleCancel}
          title="Upload Media"
          size="sm"
          showCloseButton={!isUploading}
          headerAction={
            isUploading ? (
              <Button
                variant="tertiary"
                svg={Minimize2}
                onClick={() => setIsMinimized(true)}
                title="Minimize to bottom right"
                iconSize="lg"
                aria-label="Minimize modal"
              />
            ) : undefined
          }
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold">Media Files</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={handleFileSelect}
                disabled={isUploading}
                className="hidden"
              />
              <div className="flex flex-col items-center gap-2">
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="w-full justify-center"
                >
                  Choose Files
                </Button>
                <FileList
                  files={selectedFiles}
                  isUploading={isUploading}
                  onRemoveFile={handleRemoveFile}
                />
              </div>
              {selectedFiles.length > 0 && (
                <div className="text-xs text-gray-400 text-center">
                  {imageCount > 0 && videoCount > 0 && (
                    <span>
                      {imageCount} {imageCount === 1 ? 'image' : 'images'} and {videoCount} {videoCount === 1 ? 'video' : 'videos'} selected
                    </span>
                  )}
                  {imageCount > 0 && videoCount === 0 && (
                    <span>
                      {imageCount} {imageCount === 1 ? 'image' : 'images'} selected
                    </span>
                  )}
                  {imageCount === 0 && videoCount > 0 && (
                    <span>
                      {videoCount} {videoCount === 1 ? 'video' : 'videos'} selected
                    </span>
                  )}
                </div>
              )}
            </div>

            <UploadStatusDisplay
              uploadStatus={uploadStatus}
              statusMessage={statusMessage}
              overallProgress={overallProgress}
              currentFileIndex={currentFileIndex}
              totalFiles={selectedFiles.length}
            />

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <div className="flex gap-2 justify-end mt-2">
              <Button variant="secondary" onClick={handleCancel}>
                {isUploading ? "Cancel Upload" : "Cancel"}
              </Button>
              <Button
                variant="cta"
                onClick={handleUpload}
                disabled={selectedFiles.length === 0 || isUploading}
                svg={Upload}
              >
                {isUploading
                  ? `Uploading... (${currentFileIndex + 1}/${selectedFiles.length})`
                  : `Upload ${selectedFiles.length > 0 ? `(${selectedFiles.length} ${selectedFiles.length === 1 ? 'file' : 'files'})` : ""}`}
              </Button>
            </div>

            <div className="pt-4 border-t border-gray-700">
              <p className="text-xs text-gray-400">
                Select one or more images or videos to upload. 
                Processing may take a few minutes depending on file size.
              </p>
            </div>
          </div>
        </Modal>
      </>
    );
  }
);

MediaUploadInput.displayName = "MediaUploadInput";

export default MediaUploadInput;
export type { MediaUploadInputRef } from "./MediaUploadInput.types";
