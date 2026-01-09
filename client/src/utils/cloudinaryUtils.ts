import { Cloudinary } from "@cloudinary/url-gen";

export const deleteFromCloudinary = async (
  cloud: Cloudinary,
  publicId: string,
  resourceType?: "image" | "video"
): Promise<boolean> => {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_API_BASE_PATH}api/cloudinary/delete`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ publicId, resourceType }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Server error:", errorData);
      return false;
    }

    const result = await response.json();
    return result.success === true;
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
