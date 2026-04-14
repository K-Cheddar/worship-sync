import { FLUSH_MEDIA_NO_DB_MESSAGE } from "../../utils/flushMediaLibraryDoc";

export function alertMediaLibraryFlushFailed(
  error: unknown,
  scope: "folder" | "library",
) {
  const noDb =
    error instanceof Error && error.message === FLUSH_MEDIA_NO_DB_MESSAGE;
  const reason = noDb
    ? "There is no local database connection, so this was not saved to disk."
    : "Could not save to the local database. Check your connection and try again.";
  const intro =
    scope === "folder"
      ? "The folder was updated on this device only."
      : "The media library was updated on this device only.";
  window.alert(`${intro} ${reason}`);
}
