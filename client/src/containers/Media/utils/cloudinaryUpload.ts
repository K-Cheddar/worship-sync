import { mediaInfoType } from "../cloudinaryTypes";

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
  callbacks: UploadCallbacks = {},
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
          reject(
            new Error(
              errorData.error?.message ||
                `Upload failed with status ${xhr.status}`,
            ),
          );
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

    xhr.open(
      "POST",
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    );
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
