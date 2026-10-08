import { mediaInfoType } from "../cloudinaryTypes";
import { deleteCloudinaryAsset } from "../../../utils/cloudinaryUtils";
import type { CloudinaryImageUploadIntent } from "../../../api/providerStorage";

function requireNonEmptyString(value: unknown, fieldLabel: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Upload completed but ${fieldLabel} was missing or invalid. Try again.`,
    );
  }
  return value.trim();
}

function requirePositiveFiniteNumber(
  value: unknown,
  fieldLabel: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Upload completed but ${fieldLabel} was missing or invalid. Try again.`,
    );
  }
  return value;
}

function requireNonNegativeFiniteInt(
  value: unknown,
  fieldLabel: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isInteger(value)
  ) {
    throw new Error(
      `Upload completed but ${fieldLabel} was missing or invalid. Try again.`,
    );
  }
  return value;
}

export type CloudinaryUploadCallbacks = {
  onProgress?: (progress: number) => void;
  onStatusUpdate?: (message: string) => void;
  isCancelled?: () => boolean;
  setXhr?: (xhr: XMLHttpRequest) => void;
};

export type CloudinaryUploadOptions = {
  folder?: string;
  assetFolder?: string;
};

const uploadImageWithFormData = async (
  file: File,
  formData: FormData,
  uploadUrl: string,
  callbacks: CloudinaryUploadCallbacks = {},
  expectedPublicId?: string,
): Promise<mediaInfoType> => {
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
      // A successful response can race cancellation. Parse its public ID so the
      // caller can remove the provider asset before marking the job cancelled.
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        try {
          const errorData = JSON.parse(xhr.responseText);
          const error = new Error(
            errorData.error?.message || `Upload failed with status ${xhr.status}`,
          ) as Error & { status?: number; code?: string };
          error.status = xhr.status;
          if (typeof errorData.error?.code === "string") {
            error.code = errorData.error.code;
          }
          reject(error);
        } catch {
          const error = new Error(`Upload failed with status ${xhr.status}`) as Error & { status?: number };
          error.status = xhr.status;
          reject(error);
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

    xhr.open("POST", uploadUrl);
    xhr.send(formData);
  });

  let response: unknown;
  try {
    response = JSON.parse(xhr.responseText);
  } catch {
    throw new Error(
      "Upload completed but the server response could not be read. Try again.",
    );
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error(
      "Upload completed but the server response was not valid upload data.",
    );
  }
  const body = response as Record<string, unknown>;
  const secureUrl = requireNonEmptyString(body.secure_url, "secure_url");
  const publicId = requireNonEmptyString(body.public_id, "public_id");
  if (expectedPublicId && publicId !== expectedPublicId) {
    throw new Error("Cloudinary returned an unexpected image ID.");
  }
  const width = requirePositiveFiniteNumber(body.width, "width");
  const height = requirePositiveFiniteNumber(body.height, "height");
  const format = requireNonEmptyString(body.format, "format");
  const createdAt = requireNonEmptyString(body.created_at, "created_at");
  const bytes = requireNonNegativeFiniteInt(body.bytes, "bytes");

  const assetId =
    typeof body.asset_id === "string" && body.asset_id.trim()
      ? body.asset_id.trim()
      : "";
  const id = assetId || publicId;

  const url =
    typeof body.url === "string" && body.url.trim()
      ? body.url.trim()
      : secureUrl;

  const tagsRaw = body.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.filter((t): t is string => typeof t === "string")
    : [];

  const localName = file.name.trim();
  const displayOriginalFilename =
    localName ||
    (typeof body.original_filename === "string"
      ? body.original_filename.trim()
      : "") ||
    "image";

  // Transform Cloudinary response to mediaInfoType format
  const mediaInfo: mediaInfoType = {
    id,
    batchId:
      typeof body.batchId === "string" && body.batchId.trim()
        ? body.batchId.trim()
        : "",
    asset_id: assetId,
    public_id: publicId,
    version:
      typeof body.version === "number" &&
      Number.isFinite(body.version) &&
      body.version > 0
        ? body.version
        : 1,
    version_id:
      typeof body.version_id === "string" && body.version_id.trim()
        ? body.version_id.trim()
        : "",
    signature:
      typeof body.signature === "string" && body.signature.trim()
        ? body.signature.trim()
        : "",
    width,
    height,
    format,
    resource_type: "image" as const,
    created_at: createdAt,
    tags,
    pages:
      typeof body.pages === "number" &&
      Number.isFinite(body.pages) &&
      body.pages >= 1
        ? Math.floor(body.pages)
        : 1,
    bytes,
    type:
      typeof body.type === "string" && body.type.trim()
        ? body.type.trim()
        : "upload",
    etag:
      typeof body.etag === "string" && body.etag.trim() ? body.etag.trim() : "",
    placeholder: body.placeholder === true,
    url,
    secure_url: secureUrl,
    folder:
      typeof body.folder === "string" && body.folder.trim()
        ? body.folder.trim()
        : "",
    access_mode:
      typeof body.access_mode === "string" && body.access_mode.trim()
        ? body.access_mode.trim()
        : "public",
    existing: body.existing === true,
    original_filename: displayOriginalFilename,
    path: secureUrl,
    thumbnail_url: secureUrl,
    done: true,
  };

  return mediaInfo;
};

export const uploadImageToCloudinary = (
  file: File,
  uploadPreset: string,
  cloudName: string,
  callbacks: CloudinaryUploadCallbacks = {},
  options: CloudinaryUploadOptions = {},
): Promise<mediaInfoType> => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);
  formData.append("resource_type", "image");
  if (options.folder) formData.append("folder", options.folder);
  if (options.assetFolder) formData.append("asset_folder", options.assetFolder);
  return uploadImageWithFormData(
    file,
    formData,
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    callbacks,
  );
};

export const uploadImageToCloudinarySigned = (
  file: File,
  intent: CloudinaryImageUploadIntent,
  callbacks: CloudinaryUploadCallbacks = {},
): Promise<mediaInfoType> => {
  const formData = new FormData();
  formData.append("file", file);
  Object.entries(intent.fields).forEach(([key, value]) => {
    formData.append(key, value);
  });
  return uploadImageWithFormData(
    file,
    formData,
    intent.uploadUrl,
    callbacks,
    intent.publicId,
  );
};

const CLOUDINARY_CLOUD_NAME = "portable-media";

const buildCloudinaryWebpUrl = (secureUrl: string) => {
  const marker = "/image/upload/";
  const markerIndex = secureUrl.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error("The uploaded image did not include a usable cloud URL.");
  }

  const pathAndQuery = secureUrl.slice(markerIndex + marker.length);
  const queryIndex = pathAndQuery.indexOf("?");
  const path = queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : pathAndQuery.slice(queryIndex);
  const webpPath = path.replace(/\.[^/.]+$/, ".webp");

  return `${secureUrl.slice(0, markerIndex + marker.length)}f_webp,q_auto/${webpPath}${query}`;
};

const downloadCloudinaryFile = async (
  url: string,
  fileName: string,
  callbacks: CloudinaryUploadCallbacks = {},
): Promise<File> => {
  const xhr = new XMLHttpRequest();
  callbacks.setXhr?.(xhr);

  return new Promise<File>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, file?: File) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else if (file) resolve(file);
      else reject(new Error("The converted image was empty."));
    };

    if (callbacks.isCancelled?.()) {
      finish(new Error("Conversion cancelled"));
      return;
    }

    xhr.addEventListener("progress", (event) => {
      if (callbacks.isCancelled?.()) {
        xhr.abort();
        return;
      }
      if (event.lengthComputable) {
        callbacks.onProgress?.(50 + (event.loaded / event.total) * 50);
      }
    });
    xhr.addEventListener("load", () => {
      if (callbacks.isCancelled?.()) {
        finish(new Error("Conversion cancelled"));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        finish(
          new Error(`Converted image download failed with status ${xhr.status}.`),
        );
        return;
      }
      const blob = xhr.response;
      if (!(blob instanceof Blob) || blob.size <= 0) {
        finish(new Error("The converted image was empty."));
        return;
      }
      finish(undefined, new File([blob], fileName, { type: "image/webp" }));
    });
    xhr.addEventListener("error", () =>
      finish(new Error("Converted image download failed.")),
    );
    xhr.addEventListener("abort", () =>
      finish(new Error("Conversion cancelled")),
    );

    xhr.open("GET", url);
    xhr.responseType = "blob";
    xhr.send();
  });
};

export const convertCloudinaryImageToLocalWebp = async (
  file: File,
  uploadPreset: string,
  callbacks: CloudinaryUploadCallbacks = {},
  churchId?: string,
): Promise<File> => {
  let temporaryAsset: mediaInfoType | undefined;
  let operationFailed = false;
  try {
    callbacks.onStatusUpdate?.("Uploading image for conversion...");
    temporaryAsset = await uploadImageToCloudinary(
      file,
      uploadPreset,
      CLOUDINARY_CLOUD_NAME,
      {
        ...callbacks,
        onProgress: (progress) => callbacks.onProgress?.(progress * 0.5),
      },
      { folder: `temporary-conversions/${encodeURIComponent(churchId || "unscoped")}` },
    );
    callbacks.onStatusUpdate?.("Downloading converted image...");
    const baseName = file.name.replace(/\.[^/.]+$/, "") || "converted-image";
    return await downloadCloudinaryFile(
      buildCloudinaryWebpUrl(temporaryAsset.secure_url),
      `${baseName}.webp`,
      callbacks,
    );
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    if (temporaryAsset?.public_id) {
      const deleted = await deleteCloudinaryAsset(
        temporaryAsset.public_id,
        "image",
        churchId,
      );
      if (churchId && !deleted && !operationFailed) {
        throw new Error("The temporary cloud image could not be removed.");
      }
      if (!deleted) {
        console.error("Could not remove failed temporary Cloudinary image.");
      }
    }
  }
};
