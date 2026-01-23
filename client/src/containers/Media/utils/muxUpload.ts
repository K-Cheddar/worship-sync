import { getApiBasePath } from "../../../utils/environment";
import { MuxUploadResult } from "../MediaUploadInput.types";

type PollingCallbacks = {
  onProgress?: (progress: number) => void;
  onStatusUpdate?: (message: string) => void;
  isCancelled?: () => boolean;
};

export const pollUploadStatus = async (
  uploadId: string,
  callbacks: PollingCallbacks & { addTimeout?: (timeoutId: NodeJS.Timeout) => void } = {}
): Promise<string | null> => {
  const maxAttempts = 60; // 5 minutes max
  let attempts = 0;

  while (attempts < maxAttempts) {
    if (callbacks.isCancelled?.()) {
      throw new Error("Upload cancelled");
    }

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
      await new Promise<void>((resolve) => {
        const timeoutId = setTimeout(() => resolve(), 5000);
        callbacks.addTimeout?.(timeoutId);
      });
      attempts++;
    } catch (err) {
      if (callbacks.isCancelled?.()) {
        throw new Error("Upload cancelled");
      }
      console.error("Error polling upload status:", err);
      throw err;
    }
  }

  throw new Error("Upload timeout");
};

export const pollAssetStatus = async (
  assetId: string,
  callbacks: PollingCallbacks & { addTimeout?: (timeoutId: NodeJS.Timeout) => void } = {}
): Promise<{ playbackId: string; assetId: string }> => {
  const maxAttempts = 120; // 10 minutes max
  let attempts = 0;

  while (attempts < maxAttempts) {
    if (callbacks.isCancelled?.()) {
      throw new Error("Upload cancelled");
    }

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

      callbacks.onStatusUpdate?.(`Processing video... (${attempts * 5}s)`);
      
      // Wait 5 seconds before next poll
      await new Promise<void>((resolve) => {
        const timeoutId = setTimeout(() => resolve(), 5000);
        callbacks.addTimeout?.(timeoutId);
      });
      attempts++;
    } catch (err) {
      if (callbacks.isCancelled?.()) {
        throw new Error("Upload cancelled");
      }
      console.error("Error polling asset status:", err);
      throw err;
    }
  }

  throw new Error("Processing timeout");
};

export const uploadVideoToMux = async (
  file: File,
  callbacks: {
    onProgress?: (progress: number) => void;
    onStatusUpdate?: (message: string) => void;
    isCancelled?: () => boolean;
    setXhr?: (xhr: XMLHttpRequest) => void;
    addTimeout?: (timeoutId: NodeJS.Timeout) => void;
  } = {}
): Promise<MuxUploadResult> => {
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
  callbacks.setXhr?.(xhr);

  await new Promise<void>((resolve, reject) => {
    if (callbacks.isCancelled?.()) {
      xhr.abort();
      reject(new Error("Upload cancelled"));
      return;
    }

    xhr.upload.addEventListener("progress", (e) => {
      if (callbacks.isCancelled?.()) {
        xhr.abort();
        return;
      }
      if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100;
        callbacks.onProgress?.(percentComplete);
      }
    });

    xhr.addEventListener("load", () => {
      if (callbacks.isCancelled?.()) {
        reject(new Error("Upload cancelled"));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    xhr.addEventListener("error", () => {
      if (callbacks.isCancelled?.()) {
        reject(new Error("Upload cancelled"));
      } else {
        reject(new Error("Upload failed"));
      }
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload cancelled"));
    });

    xhr.open("PUT", uploadUrl);
    xhr.send(file);
  });

  // Step 3: Wait for asset to be created
  callbacks.onStatusUpdate?.("Processing upload...");
  const assetId = await pollUploadStatus(uploadId, callbacks);

  if (!assetId) {
    throw new Error("Failed to get asset ID");
  }

  // Step 4: Wait for asset to be ready
  callbacks.onStatusUpdate?.("Processing video...");
  const { playbackId, assetId: finalAssetId } = await pollAssetStatus(assetId, {
    ...callbacks,
    addTimeout: callbacks.addTimeout,
  });

  // Step 5: Generate URLs
  const playbackUrl = `https://stream.mux.com/${playbackId}.m3u8`;
  const thumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.png?width=250&height=141&fit_mode=pad&time=1`;
  const name = file.name.replace(/\.[^/.]+$/, "");

  return {
    playbackId,
    assetId: finalAssetId,
    playbackUrl,
    thumbnailUrl,
    name,
  };
};
