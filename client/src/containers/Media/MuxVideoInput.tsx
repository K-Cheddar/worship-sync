import { useState, useRef } from "react";
import { Video, Upload } from "lucide-react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
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
};

type UploadStatus = "idle" | "uploading" | "processing" | "ready" | "error";

const MuxVideoInput = ({ onComplete }: MuxVideoInputProps) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [videoName, setVideoName] = useState("");
  const [error, setError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith("video/")) {
        setError("Please select a valid video file");
        return;
      }
      
      setSelectedFile(file);
      setError("");
      
      // Auto-populate name if empty
      if (!videoName) {
        setVideoName(file.name.replace(/\.[^/.]+$/, ""));
      }
    }
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

  const handleUpload = async () => {
    if (!selectedFile) {
      setError("Please select a video file");
      return;
    }

    setError("");
    setUploadStatus("uploading");
    setStatusMessage("Preparing upload...");

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
      setStatusMessage("Uploading video...");
      
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          setUploadProgress(percentComplete);
          setStatusMessage(`Uploading... ${Math.round(percentComplete)}%`);
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
        xhr.send(selectedFile);
      });

      // Step 3: Wait for asset to be created
      setUploadStatus("processing");
      setStatusMessage("Processing upload...");
      setUploadProgress(0);

      const assetId = await pollUploadStatus(uploadId);
      
      if (!assetId) {
        throw new Error("Failed to get asset ID");
      }

      // Step 4: Wait for asset to be ready
      setStatusMessage("Processing video...");
      const { playbackId, assetId: finalAssetId } = await pollAssetStatus(assetId);

      // Step 5: Complete
      setUploadStatus("ready");
      setStatusMessage("Upload complete!");

      const playbackUrl = `https://stream.mux.com/${playbackId}.m3u8`;
      const thumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.png?width=250&height=141&fit_mode=pad&time=1`;
      const name = videoName || selectedFile.name.replace(/\.[^/.]+$/, "");

      onComplete({
        playbackId,
        assetId: finalAssetId,
        playbackUrl,
        thumbnailUrl,
        name,
      });

      // Reset and close
      setTimeout(() => {
        handleCancel();
      }, 1000);

    } catch (err) {
      console.error("Upload error:", err);
      setUploadStatus("error");
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const handleCancel = () => {
    setSelectedFile(null);
    setVideoName("");
    setError("");
    setUploadStatus("idle");
    setUploadProgress(0);
    setStatusMessage("");
    setIsModalOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const isUploading = uploadStatus === "uploading" || uploadStatus === "processing";

  return (
    <>
      <Button
        variant="tertiary"
        svg={Video}
        onClick={() => setIsModalOpen(true)}
        title="Upload Mux Video"
      >
        Add
      </Button>

      <Modal
        isOpen={isModalOpen}
        onClose={isUploading ? () => {} : handleCancel}
        title="Upload Video to Mux"
        size="sm"
        showCloseButton={!isUploading}
        
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold">Video File</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
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
                Choose File
              </Button>
              <div className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded flex items-center justify-center text-sm">
                {selectedFile ? (
                  <span className="text-gray-300 truncate">
                    {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                ) : (
                  <span className="text-gray-500">No file selected</span>
                )}
              </div>
            </div>
          </div>

          <Input
            label="Video Name"
            type="text"
            value={videoName}
            onChange={(value) => setVideoName(value as string)}
            placeholder="My Worship Background"
            inputTextSize="text-sm"
            disabled={isUploading}
          />

          {uploadStatus !== "idle" && (
            <div className="bg-gray-900 p-3 rounded">
              <p className="text-sm text-gray-300 mb-2">{statusMessage}</p>
              {uploadStatus === "uploading" && (
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
              {uploadStatus === "processing" && (
                <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div className="bg-blue-600 h-2 rounded-full animate-pulse w-full" />
                </div>
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
              disabled={!selectedFile || isUploading}
              svg={Upload}
            >
              {isUploading ? "Uploading..." : "Upload"}
            </Button>
          </div>

          <div className="pt-4 border-t border-gray-700">
            <p className="text-xs text-gray-400">
              Select a video file to upload to Mux. Supported formats: MP4, MOV, AVI, and more. 
              Processing may take a few minutes depending on video size.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
};

export default MuxVideoInput;
