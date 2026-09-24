export const buildYouTubeSearchQuery = ({
  title,
  artist,
  album,
}: {
  title?: string;
  artist?: string;
  album?: string;
}) => {
  const clean = (value?: string) => value?.trim().replace(/\s+/g, " ") || "";
  const cleanTitle = clean(title);
  const cleanArtist = clean(artist);
  const cleanAlbum = clean(album);
  if (cleanTitle) return [cleanTitle, cleanArtist || cleanAlbum].filter(Boolean).join(" ");
  return [cleanArtist, cleanAlbum].filter(Boolean).join(" ");
};

export const formatYouTubeDuration = (seconds?: number) => {
  if (!Number.isFinite(seconds) || seconds === undefined) return "";
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
};
