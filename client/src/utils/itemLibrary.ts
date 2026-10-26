import type { DBItem, ServiceItem } from "../types";

export const itemDocumentToLibraryEntry = (doc: Pick<ServiceItem, "_id" | "name" | "type" | "background" | "localImage" | "localVideoFile"> & Partial<Pick<DBItem, "slides" | "arrangements" | "selectedArrangement">>): ServiceItem => {
  const firstSlide = doc.type === "song"
    ? doc.arrangements?.[doc.selectedArrangement ?? 0]?.slides?.[0] ?? doc.slides?.[0]
    : doc.slides?.[0];
  const mediaInfo = firstSlide?.boxes?.[0]?.mediaInfo;
  const localImage = doc.localImage ?? mediaInfo?.localImage;
  const localVideoFile = doc.localVideoFile ?? mediaInfo?.localVideoFile;
  return {
    _id: doc._id,
    name: doc.name,
    type: doc.type,
    listId: doc._id,
    background: mediaInfo?.type === "video"
      ? localVideoFile?.cloudUrl || mediaInfo.placeholderImage || doc.background || ""
      : localImage?.cloudUrl || doc.background || "",
    ...(localImage ? { localImage } : {}),
    ...(localVideoFile ? { localVideoFile } : {}),
  };
};
