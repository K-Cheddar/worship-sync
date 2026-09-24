import {
  createChurchMuxUpload,
  deleteChurchMuxAsset,
  getChurchMuxAsset,
  getChurchMuxUpload,
} from "../../../api/providerStorage";
import { MuxUploadResult } from "../MediaUploadInput.types";

type PollingCallbacks = {
  onProgress?: (progress: number) => void;
  onStatusUpdate?: (message: string) => void;
  isCancelled?: () => boolean;
  requireStaticRendition?: boolean;
  addTimeout?: (timeoutId: NodeJS.Timeout, cancel: () => void) => void;
};

export type MuxUploadCallbacks = PollingCallbacks & {
  setXhr?: (xhr: XMLHttpRequest) => void;
};

export type MuxUploadOptions = {
  churchId: string;
  mediaId?: string;
  title?: string;
  temporary?: boolean;
};

const waitForPollingInterval = async (
  callbacks: PollingCallbacks,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      settled = true;
      resolve();
    }, 5000);
    const cancel = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(new Error("Upload cancelled"));
    };
    callbacks.addTimeout?.(timeoutId, cancel);
  });

export const pollUploadStatus = async (
  uploadId: string,
  churchId: string,
  callbacks: PollingCallbacks = {},
): Promise<string | null> => {
  const maxAttempts = 60; // 5 minutes max
  let attempts = 0;

  while (attempts < maxAttempts) {
    if (callbacks.isCancelled?.()) {
      throw new Error("Upload cancelled");
    }

    try {
      const data = await getChurchMuxUpload(churchId, uploadId);

      if (data.status === "asset_created" && data.assetId) {
        return data.assetId;
      } else if (data.status === "errored") {
        throw new Error("Upload failed");
      }

      await waitForPollingInterval(callbacks);
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
  churchId: string,
  callbacks: PollingCallbacks = {},
): Promise<{
  playbackId: string;
  assetId: string;
  staticRenditionReady: boolean;
  durationSeconds: number;
}> => {
  const maxAttempts = 120; // 10 minutes max
  let attempts = 0;

  while (attempts < maxAttempts) {
    if (callbacks.isCancelled?.()) {
      throw new Error("Upload cancelled");
    }

    try {
      const data = await getChurchMuxAsset(churchId, assetId);

      const staticRenditionReady = data.staticRenditionReady === true;
      if (
        data.status === "ready" &&
        data.playbackId &&
        (!callbacks.requireStaticRendition || staticRenditionReady)
      ) {
        return {
          playbackId: data.playbackId,
          assetId,
          staticRenditionReady,
          durationSeconds: Number(data.duration),
        };
      } else if (data.status === "errored") {
        throw new Error("Asset processing failed");
      }

      callbacks.onStatusUpdate?.(
        callbacks.requireStaticRendition && data.status === "ready"
          ? `Preparing offline video... (${attempts * 5}s)`
          : `Processing video... (${attempts * 5}s)`,
      );
      
      await waitForPollingInterval(callbacks);
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

export const deleteMuxAsset = async (
  assetId: string,
  churchId: string,
): Promise<void> => {
  await deleteChurchMuxAsset(churchId, assetId);
};

export const downloadMuxMp4 = async (
  result: MuxUploadResult,
  callbacks: MuxUploadCallbacks = {},
): Promise<File> => {
  const downloadUrl =
    result.mp4Url || `https://stream.mux.com/${result.playbackId}/highest.mp4`;
  const xhr = new XMLHttpRequest();
  callbacks.setXhr?.(xhr);

  return new Promise<File>((resolve, reject) => {
    if (callbacks.isCancelled?.()) {
      reject(new Error("Conversion cancelled"));
      return;
    }
    xhr.open("GET", downloadUrl);
    xhr.responseType = "blob";
    xhr.addEventListener("progress", (event) => {
      if (callbacks.isCancelled?.()) {
        xhr.abort();
        return;
      }
      if (event.lengthComputable) {
        callbacks.onProgress?.((event.loaded / event.total) * 100);
      }
    });
    xhr.addEventListener("load", () => {
      if (callbacks.isCancelled?.()) {
        reject(new Error("Conversion cancelled"));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new Error(
            `Converted video download failed with status ${xhr.status}.`,
          ),
        );
        return;
      }
      const blob = xhr.response;
      if (!(blob instanceof Blob) || blob.size <= 0) {
        reject(new Error("The converted video was empty."));
        return;
      }
      resolve(
        new File(
          [blob],
          `${result.name || "converted-video"}.mp4`,
          { type: "video/mp4" },
        ),
      );
    });
    xhr.addEventListener("error", () =>
      reject(new Error("Converted video download failed.")),
    );
    xhr.addEventListener("abort", () =>
      reject(new Error("Conversion cancelled")),
    );
    xhr.send();
  });
};

export const convertMuxVideoToLocalMp4 = async (
  file: File,
  churchId: string,
  callbacks: MuxUploadCallbacks = {},
): Promise<File> => {
  let temporaryAssetId: string | undefined;
  let operationFailed = false;
  try {
    const result = await uploadVideoToMux(file, { churchId, title: file.name, temporary: true }, {
      ...callbacks,
      requireStaticRendition: true,
    });
    temporaryAssetId = result.assetId;
    callbacks.onStatusUpdate?.("Downloading converted video...");
    return await downloadMuxMp4(result, callbacks);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    if (temporaryAssetId) {
      try {
        await deleteMuxAsset(temporaryAssetId, churchId);
      } catch (cleanupError) {
        if (!operationFailed) throw cleanupError;
        console.error("Could not remove failed temporary Mux asset:", cleanupError);
      }
    }
  }
};

export const uploadVideoToMux = async (
  file: File,
  options: MuxUploadOptions,
  callbacks: MuxUploadCallbacks = {},
): Promise<MuxUploadResult> => {
  const { uploadId, url: uploadUrl } = await createChurchMuxUpload(
    options.churchId,
    {
      mediaId: options.mediaId || "",
      title: options.title || file.name,
      temporary: options.temporary,
    },
  );

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
  const assetId = await pollUploadStatus(uploadId, options.churchId, callbacks);

  if (!assetId) {
    throw new Error("Failed to get asset ID");
  }

  try {
    // Step 4: Wait for asset to be ready
    callbacks.onStatusUpdate?.("Processing video...");
    const { playbackId, assetId: finalAssetId, durationSeconds } =
      await pollAssetStatus(assetId, options.churchId, callbacks);

    // Step 5: Generate URLs
    const playbackUrl = `https://stream.mux.com/${playbackId}.m3u8`;
    const thumbnailUrl = `https://image.mux.com/${playbackId}/thumbnail.png?width=250&height=141&fit_mode=pad&time=1`;
    const name = file.name.replace(/\.[^/.]+$/, "");

    return {
      playbackId,
      assetId: finalAssetId,
      playbackUrl,
      mp4Url: `https://stream.mux.com/${playbackId}/highest.mp4`,
      thumbnailUrl,
      name,
      durationSeconds,
    };
  } catch (error) {
    try {
      await deleteMuxAsset(assetId, options.churchId);
    } catch (cleanupError) {
      console.error("Could not remove failed Mux asset:", cleanupError);
    }
    throw error;
  }
};
