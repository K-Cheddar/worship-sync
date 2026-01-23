import { mediaInfoType } from "../cloudinaryTypes";

type UploadCallbacks = {
  onProgress?: (progress: number) => void;
  onStatusUpdate?: (message: string) => void;
  isCancelled?: () => boolean;
  setXhr?: (xhr: XMLHttpRequest) => void;
};

export const uploadImageToCloudinary = async (
  file: File,
  uploadPreset: string,
  cloudName: string,
  callbacks: UploadCallbacks = {}
): Promise<mediaInfoType> => {
  // Create FormData for Cloudinary unsigned upload
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);
  formData.append("resource_type", "image");

  // Upload to Cloudinary
  const xhr = new XMLHttpRequest();
  callbacks.setXhr?.(xhr);

  await new Promise<void>((resolve, reject) => {
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
        try {
          const errorData = JSON.parse(xhr.responseText);
          reject(new Error(errorData.error?.message || `Upload failed with status ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
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

    xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`);
    xhr.send(formData);
  });

  // Parse response
  const response = JSON.parse(xhr.responseText);
  
  // Transform Cloudinary response to mediaInfoType format
  const mediaInfo: mediaInfoType = {
    id: response.asset_id || response.public_id,
    batchId: response.batchId || "",
    asset_id: response.asset_id || "",
    public_id: response.public_id,
    version: response.version || 1,
    version_id: response.version_id || "",
    signature: response.signature || "",
    width: response.width,
    height: response.height,
    format: response.format,
    resource_type: "image" as const,
    created_at: response.created_at,
    tags: response.tags || [],
    pages: response.pages || 1,
    bytes: response.bytes,
    type: response.type || "upload",
    etag: response.etag || "",
    placeholder: response.placeholder || false,
    url: response.url,
    secure_url: response.secure_url,
    folder: response.folder || "",
    access_mode: response.access_mode || "public",
    existing: response.existing || false,
    original_filename: response.original_filename || file.name,
    path: response.secure_url,
    thumbnail_url: response.secure_url,
    done: true,
  };

  return mediaInfo;
};
