import { useState, useRef, useImperativeHandle, forwardRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Video, Upload, X, Minimize2, Maximize2 } from "lucide-react";
import Button from "../../components/Button/Button";
import Modal from "../../components/Modal/Modal";
import { getApiBasePath } from "../../utils/environment";

type MuxVideoInputProps = {
  onComplete: (muxData: {
    playbackId: string;
    assetId: string;
    playbackUrl: string;
    thumbnailUrl: string;
    name: string;
  }) => void;
  showButton?: boolean;
};

export type MuxVideoInputRef = {
  openModal: () => void;
};

type UploadStatus = "idle" | "uploading" | "processing" | "ready" | "error";

type FileUploadProgress = {
  file: File;
  status: UploadStatus;
  progress: number;
  error?: string;
};

const MuxVideoInput = forwardRef<MuxVideoInputRef, MuxVideoInputProps>(
  ({ onComplete, showButton = true }, ref) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [error, setError] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<FileUploadProgress[]>([]);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [overallProgress, setOverallProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    // Validate all files
    const invalidFiles = files.filter((file) => !file.type.startsWith("video/"));
    if (invalidFiles.length > 0) {
      setError(`Please select valid video files. ${invalidFiles.length} invalid file(s) found.`);
      return;
    }

    const newFiles: FileUploadProgress[] = files.map((file) => ({
      file,
      status: "idle" as UploadStatus,
      progress: 0,
    }));

    setSelectedFiles((prev) => [...prev, ...newFiles]);
    setError("");
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const pollUploadStatus = async (uploadId: string): Promise<string | null> => {
    const maxAttempts = 60; // 5 minutes max
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(
          `${getApiBasePath()}api/mux/upload/${uploadId}`
        );
        const data = await response.json();

        if (data.status === "asset_created" && data.assetId) {
          return data.assetId;
        } else if (data.status === "errored") {
          throw new Error("Upload failed");
        }

        // Wait 5 seconds before next poll
        await new Promise((resolve) => setTimeout(resolve, 5000));
        attempts++;
      } catch (err) {
        console.error("Error polling upload status:", err);
        throw err;
      }
    }

    throw new Error("Upload timeout");
  };

  const pollAssetStatus = async (assetId: string): Promise<{ playbackId: string; assetId: string }> => {
    const maxAttempts = 120; // 10 minutes max
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await fetch(
          `${getApiBasePath()}api/mux/asset/${assetId}`
        );
        const data = await response.json();

        if (data.status === "ready" && data.playbackId) {
          return { playbackId: data.playbackId, assetId };
        } else if (data.status === "errored") {
          throw new Error("Asset processing failed");
        }

        setStatusMessage(`Processing video... (${attempts * 5}s)`);
        
        // Wait 5 seconds before next poll
        await new Promise((resolve) => setTimeout(resolve, 5000));
        attempts++;
      } catch (err) {
        console.error("Error polling asset status:", err);
        throw err;
      }
    }

    throw new Error("Processing timeout");
  };

  const uploadSingleFile = async (
    file: File,
    fileIndex: number,
    totalFiles: number
  ): Promise<void> => {
    // Update file status to uploading
    setSelectedFiles((prev) =>
      prev.map((item, idx) =>
        idx === fileIndex ? { ...item, status: "uploading", progress: 0 } : item
      )
    );

    setStatusMessage(`Uploading ${fileIndex + 1}/${totalFiles}: ${file.name}...`);

    try {
      // Step 1: Get upload URL from our server
      const uploadResponse = await fetch(`${getApiBasePath()}api/mux/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          corsOrigin: window.location.origin,
        }),
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to create upload");
      }

      const { uploadId, url: uploadUrl } = await uploadResponse.json();

      // Step 2: Upload file directly to Mux
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          const fileProgress = percentComplete * 0.4; // Upload is 40% of total process
          const overallFileProgress =
            (fileIndex / totalFiles) * 100 + fileProgress / totalFiles;

          setSelectedFiles((prev) =>
            prev.map((item, idx) =>
              idx === fileIndex
                ? { ...item, progress: percentComplete }
                : item
            )
          );
          setOverallProgress(overallFileProgress);
          setStatusMessage(
            `Uploading ${fileIndex + 1}/${totalFiles}: ${file.name}... ${Math.round(percentComplete)}%`
          );
        }
      });

      await new Promise<void>((resolve, reject) => {
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener("error", () => {
          reject(new Error("Upload failed"));
        });

        xhr.open("PUT", uploadUrl);
        xhr.send(file);
      });

      // Step 3: Wait for asset to be created
      setSelectedFiles((prev) =>
        prev.map((item, idx) =>
          idx === fileIndex ? { ...item, status: "processing", progress: 40 } : item
        )
      );
      setStatusMessage(
        `Processing upload ${fileIndex + 1}/${totalFiles}: ${file.name}...`
      );

      const assetId = await pollUploadStatus(uploadId);

      if (!assetId) {
        throw new Error("Failed to get asset ID");
      }

      // Step 4: Wait for asset to be ready
      setStatusMessage(
        `Processing video ${fileIndex + 1}/${totalFiles}: ${file.name}...`
      );
      const { playbackId, assetId: finalAssetId } = await pollAssetStatus(assetId);

      // Step 5: Complete
      setSelectedFiles((prev) =>
        prev.map((item, idx) =>
          idx === fileIndex ? { ...item, status: "ready", progress: 100 } : item
        )
      );

      const playbackUrl = `https://stream.mux.com/${playbackId}.m3u8`;
      const thumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.png?width=250&height=141&fit_mode=pad&time=1`;
      const name = file.name.replace(/\.[^/.]+$/, "");

      onComplete({
        playbackId,
        assetId: finalAssetId,
        playbackUrl,
        thumbnailUrl,
        name,
      });

      // Update overall progress
      const overallProgress = ((fileIndex + 1) / totalFiles) * 100;
      setOverallProgress(overallProgress);
    } catch (err) {
      console.error("Upload error:", err);
      setSelectedFiles((prev) =>
        prev.map((item, idx) =>
          idx === fileIndex
            ? {
                ...item,
                status: "error",
                error: err instanceof Error ? err.message : "Upload failed",
              }
            : item
        )
      );
      throw err;
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      setError("Please select at least one video file");
      return;
    }

    setError("");
    setUploadStatus("uploading");
    setOverallProgress(0);
    setCurrentFileIndex(0);
    setStatusMessage("Starting uploads...");
    setIsMinimized(true); // Auto-minimize when upload starts

    const totalFiles = selectedFiles.length;
    let successCount = 0;
    let errorCount = 0;

    // Upload files sequentially
    for (let i = 0; i < selectedFiles.length; i++) {
      setCurrentFileIndex(i);
      try {
        await uploadSingleFile(selectedFiles[i].file, i, totalFiles);
        successCount++;
      } catch (err) {
        errorCount++;
        console.error(`Failed to upload file ${i + 1}:`, err);
      }
    }

    // Final status
    if (errorCount === 0) {
      setUploadStatus("ready");
      setStatusMessage(`All ${successCount} file(s) uploaded successfully!`);
    } else if (successCount === 0) {
      setUploadStatus("error");
      setError(`All ${errorCount} file(s) failed to upload`);
    } else {
      setUploadStatus("ready");
      setStatusMessage(
        `Upload complete! ${successCount} succeeded, ${errorCount} failed.`
      );
    }

    // Reset and close after delay if all succeeded
    if (errorCount === 0) {
      setTimeout(() => {
        handleCancel();
      }, 2000);
    }
  };

  const handleCancel = () => {
    setSelectedFiles([]);
    setError("");
    setUploadStatus("idle");
    setOverallProgress(0);
    setStatusMessage("");
    setCurrentFileIndex(0);
    setIsMinimized(false);
    setIsModalOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleMinimize = () => {
    setIsMinimized(true);
  };

  const handleRestore = () => {
    setIsMinimized(false);
  };

  const openModal = () => {
    setIsModalOpen(true);
    setIsMinimized(false);
  };

  useImperativeHandle(ref, () => ({
    openModal,
  }));

  const isUploading = uploadStatus === "uploading" || uploadStatus === "processing";
  const showProgressPopup = (isUploading || uploadStatus === "ready" || uploadStatus === "error") && isMinimized;

  // Prevent navigation away when upload is in progress
  // Block browser navigation (closing tab, refreshing, navigating to different site)
  useEffect(() => {
    if (isUploading) {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        // Modern browsers require returnValue to be set
        e.returnValue = "You have an active video upload in progress. Are you sure you want to leave? Your upload will be cancelled.";
        return e.returnValue;
      };

      window.addEventListener("beforeunload", handleBeforeUnload);

      return () => {
        window.removeEventListener("beforeunload", handleBeforeUnload);
      };
    }
  }, [isUploading]);

  // Find the controller element to use as portal target (same as Modal)
  const getControllerElement = () => {
    const controllerMain = document.getElementById("controller-main");
    if (controllerMain) {
      return controllerMain;
    }
    return document.body;
  };

  const progressPopupContent = showProgressPopup ? (
    <div
      className="fixed bottom-4 right-4 z-100 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl min-w-[320px] max-w-[400px] cursor-pointer hover:border-gray-500 transition-colors"
      onClick={handleRestore}
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">
            Upload Progress{" "}
            <span className="text-gray-400 font-normal">
              {Math.round(uploadStatus === "ready" ? 100 : overallProgress)}%
            </span>
          </h3>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleRestore();
            }}
            className="text-gray-400 hover:text-white transition-colors"
            type="button"
          >
            <Maximize2 size={16} />
          </button>
        </div>
        <p className="text-xs text-gray-300 mb-2 truncate">{statusMessage}</p>
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${
              uploadStatus === "error"
                ? "bg-red-600"
                : uploadStatus === "ready"
                ? "bg-green-600"
                : "bg-blue-600"
            }`}
            style={{ width: `${uploadStatus === "ready" ? 100 : overallProgress}%` }}
          />
        </div>
        {selectedFiles.length > 1 && (
          <p className="text-xs text-gray-400 mt-2">
            {uploadStatus === "ready" || uploadStatus === "error"
              ? `${selectedFiles.length} files`
              : `${currentFileIndex + 1}/${selectedFiles.length} files`}
          </p>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      {showButton && (
        <Button
          variant="tertiary"
          svg={Video}
          onClick={() => {
            setIsModalOpen(true);
            setIsMinimized(false);
          }}
          title="Upload Mux Video"
        >
          Add
        </Button>
      )}

      {/* Progress Popup - Bottom Right (rendered via portal) */}
      {createPortal(progressPopupContent, getControllerElement())}

      <Modal
        isOpen={isModalOpen && !isMinimized}
        onClose={isUploading ? () => {} : handleCancel}
        title="Upload Video to Mux"
        size="sm"
        showCloseButton={!isUploading}
        headerAction={
          isUploading ? (
            <Button
              variant="tertiary"
              svg={Minimize2}
              onClick={handleMinimize}
              title="Minimize to bottom right"
              iconSize="lg"
              aria-label="Minimize modal"
            />
          ) : undefined
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold">Video Files</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
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
              {selectedFiles.length > 0 && (
                <div className="w-full flex flex-col gap-2 max-h-48 overflow-y-auto">
                  {selectedFiles.map((fileProgress, index) => (
                    <div
                      key={index}
                      className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded flex items-center justify-between gap-2 text-sm"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-gray-300 truncate">
                          {fileProgress.file.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {(fileProgress.file.size / 1024 / 1024).toFixed(2)} MB
                          {fileProgress.status === "uploading" && (
                            <span className="ml-2">
                              - {Math.round(fileProgress.progress)}%
                            </span>
                          )}
                          {fileProgress.status === "processing" && (
                            <span className="ml-2">- Processing...</span>
                          )}
                          {fileProgress.status === "ready" && (
                            <span className="ml-2 text-green-500">- Complete</span>
                          )}
                          {fileProgress.status === "error" && (
                            <span className="ml-2 text-red-500">
                              - {fileProgress.error || "Failed"}
                            </span>
                          )}
                        </div>
                      </div>
                      {!isUploading && (
                        <button
                          onClick={() => handleRemoveFile(index)}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                          type="button"
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {selectedFiles.length === 0 && (
                <div className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded flex items-center justify-center text-sm">
                  <span className="text-gray-500">No files selected</span>
                </div>
              )}
            </div>
          </div>

          {uploadStatus !== "idle" && (
            <div className="bg-gray-900 p-3 rounded">
              <p className="text-sm text-gray-300 mb-2">{statusMessage}</p>
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
              {selectedFiles.length > 1 && (
                <p className="text-xs text-gray-400 mt-2">
                  Overall progress: {Math.round(overallProgress)}% (
                  {currentFileIndex + 1}/{selectedFiles.length} files)
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="text-red-500 text-sm">{error}</p>
          )}

          <div className="flex gap-2 justify-end mt-2">
            <Button
              variant="secondary"
              onClick={handleCancel}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button
              variant="cta"
              onClick={handleUpload}
              disabled={selectedFiles.length === 0 || isUploading}
              svg={Upload}
            >
              {isUploading
                ? `Uploading... (${currentFileIndex + 1}/${selectedFiles.length})`
                : `Upload ${selectedFiles.length > 0 ? `(${selectedFiles.length})` : ""}`}
            </Button>
          </div>

          <div className="pt-4 border-t border-gray-700">
            <p className="text-xs text-gray-400">
              Select one or more video files to upload to Mux. Supported formats: MP4, MOV, AVI, and more. 
              Processing may take a few minutes depending on video size. Files will be uploaded sequentially.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
});

MuxVideoInput.displayName = "MuxVideoInput";

export default MuxVideoInput;
