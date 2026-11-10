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
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname.toLowerCase() !== "res.cloudinary.com" ||
      parsed.port ||
      parsed.username ||
      parsed.password
    ) return null;

    const parts = parsed.pathname.split("/").filter(Boolean).map((part) =>
      decodeURIComponent(part),
    );
    if (
      parts.length < 4 ||
      !/^[a-z0-9_-]+$/i.test(parts[0]) ||
      parts[1] !== "image" ||
      parts[2] !== "upload"
    ) return null;

    const deliveryParts = parts.slice(3);
    const transformationKeys = new Set([
      "a", "ar", "b", "bo", "br", "c", "cs", "d", "dpr", "e", "f",
      "fl", "g", "h", "l", "o", "q", "r", "t", "u", "w", "x", "y", "z",
    ]);
    let firstAssetPart = 0;
    while (firstAssetPart < deliveryParts.length) {
      const tokens = deliveryParts[firstAssetPart].split(",");
      const isTransformation = tokens.length > 0 && tokens.every((token) => {
        const separator = token.indexOf("_");
        return separator > 0 && transformationKeys.has(token.slice(0, separator));
      });
      if (!isTransformation) break;
      firstAssetPart += 1;
    }
    const hasVersion = /^v\d+$/.test(deliveryParts[firstAssetPart] || "");
    const publicIdParts = deliveryParts.slice(firstAssetPart + Number(hasVersion));

    if (
      publicIdParts.length === 0 ||
      publicIdParts.some((part) => !part || part === "." || part === "..")
    ) return null;
    const lastPart = publicIdParts[publicIdParts.length - 1];
    publicIdParts[publicIdParts.length - 1] = lastPart.replace(/\.[a-z0-9]+$/i, "");
    const publicId = publicIdParts.join("/");
    return publicId && !publicId.endsWith("/") ? publicId : null;
  } catch {
    return null;
  }
};
