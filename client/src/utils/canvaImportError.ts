export class CanvaImportError extends Error {
  readonly code?: string;
  readonly status?: number;

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message);
    this.name = "CanvaImportError";
    this.code = options.code;
    this.status = options.status;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Only explicitly safe application errors may cross into the Canva panel. */
export const formatCanvaImportError = (
  error: unknown,
  format: "png" | "mp4",
): string => {
  const details = isRecord(error) ? error : {};
  const code = typeof details.code === "string" ? details.code : "";
  const message = error instanceof Error ? error.message : "";

  if (code === "CHURCH_STORAGE_QUOTA_EXCEEDED") {
    return message || "This church has reached its storage limit.";
  }
  if (code === "CHURCH_PROVIDER_STORAGE_NOT_RECONCILED") {
    return "Provider storage usage must be reconciled before uploads are enabled.";
  }
  if (code === "CHURCH_STORAGE_MUTATION_IN_PROGRESS") {
    return "Another upload is updating this file. Wait for it to finish, then try again.";
  }
  if (
    code === "CANVA_RATE_LIMITED" ||
    code === "CANVA_EXPORT_RATE_LIMITED" ||
    details.status === 429 ||
    message === "Canva is temporarily limiting export requests. Wait a moment and try again."
  ) {
    return "Canva is temporarily limiting export requests. Wait a moment and try again.";
  }

  return format === "mp4"
    ? "Video import couldn't start. Please try again."
    : "Canva import couldn't finish. Please try again.";
};
