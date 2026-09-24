import { Cloudinary } from "@cloudinary/url-gen";
import { apiFetch } from "../api/auth";

export const deleteFromCloudinary = async (
  cloud: Cloudinary,
  publicId: string,
  resourceType?: "image" | "video",
  churchId?: string,
): Promise<boolean> => {
  return deleteCloudinaryAsset(publicId, resourceType, churchId);
};

export const deleteCloudinaryAsset = async (
  publicId: string,
  resourceType?: "image" | "video",
  churchId?: string,
): Promise<boolean> => {
  if (!churchId || resourceType === "video") return false;
  try {
    await apiFetch<{ success: boolean }>("api/cloudinary/delete", {
      method: "DELETE",
      body: JSON.stringify({ publicId, resourceType }),
    });
    return true;
  } catch (error) {
    console.error("Error deleting from Cloudinary:", error);
    return false;
  }
};

export const extractPublicId = (url: string): string | null => {
  try {
    // Extract public_id from Cloudinary URL
    // Example: https://res.cloudinary.com/portable-media/image/upload/v1/backgrounds/image1.jpg
    const match = url.match(/\/upload\/v\d+\/(.+?)(?:\?|$)/);
    if (match) {
      // Remove file extension for the public_id
      return match[1].replace(/\.[^/.]+$/, "");
    }
    return null;
  } catch (error) {
    console.error("Error extracting public_id:", error);
    return null;
  }
};
