export type LocalMediaPreviewStatus = {
  sourceLabel: string;
  heading?: string;
  ownerLabel?: string;
  detail?: string;
  state?: "loading" | "unavailable";
};

type LocalMediaPreviewStatusInput = {
  kind: "image" | "video";
  isLocal: boolean;
  isOwner: boolean;
  status: "not-local" | "loading" | "ready" | "unavailable";
  fileName?: string;
  mediaName?: string;
  ownerLabel?: string;
  previewUrl?: string;
};

/** Shared by the regular and expanded Media Library preview surfaces. */
export const getLocalMediaPreviewStatus = ({
  kind,
  isLocal,
  isOwner,
  status,
  fileName,
  mediaName,
  ownerLabel,
  previewUrl,
}: LocalMediaPreviewStatusInput): LocalMediaPreviewStatus | undefined => {
  if (!isLocal || previewUrl || (status !== "loading" && status !== "unavailable")) {
    return undefined;
  }

  const name = fileName || mediaName || (kind === "image" ? "Image" : "Video");
  const sourceLabel = `Local ${kind} · ${name}`;
  if (status === "loading") {
    return {
      sourceLabel,
      heading: `Loading local ${kind}`,
      state: "loading",
    };
  }

  const noun = kind === "image" ? "image" : "video";
  return {
    sourceLabel,
    heading: isOwner ? `Local ${noun} unavailable` : undefined,
    ownerLabel: isOwner ? undefined : ownerLabel,
    detail: isOwner
      ? kind === "image"
        ? "Choose Relink in Media to restore this file."
        : "Open Media on this device and relink the file."
      : undefined,
  };
};
