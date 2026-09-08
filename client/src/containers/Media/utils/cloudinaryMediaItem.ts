import type { MediaType } from "../../../types";
import generateRandomId from "../../../utils/generateRandomId";
import type { mediaInfoType } from "../cloudinaryTypes";

export const createCloudinaryImageMediaItem = (
  info: mediaInfoType,
): MediaType => {
  const now = info.created_at || new Date().toISOString();
  return {
    path: "",
    createdAt: now,
    updatedAt: now,
    format: info.format,
    height: info.height,
    width: info.width,
    publicId: info.public_id,
    name: info.original_filename || "Image",
    type: "image",
    id: generateRandomId(),
    background: info.secure_url,
    thumbnail: info.thumbnail_url || info.secure_url,
    source: "cloudinary",
    folderId: null,
  };
};
