type DiagnosticLevel = "warn" | "error";

export const getAuthErrorDetails = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return { message: String(error ?? "Unknown error") };
  }
  const value = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    status?: unknown;
  };
  return {
    name: typeof value.name === "string" ? value.name : undefined,
    message: typeof value.message === "string" ? value.message : String(error),
    code: typeof value.code === "string" ? value.code : undefined,
    status: typeof value.status === "number" ? value.status : undefined,
  };
};

/** Structured, token-free auth diagnostics forwarded by the console logger. */
export const logAuthDiagnostic = (
  level: DiagnosticLevel,
  event: string,
  details: Record<string, unknown> = {},
) => {
  const message = JSON.stringify({ event, ...details });
  console[level]("[auth diagnostic]", message);
};
