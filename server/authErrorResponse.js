// Only this stable code authorizes the client to refresh CSRF and retry.
export const serializeAuthError = (error, details) => ({
  success: false,
  ...details,
  ...(error?.code === "AUTH_CSRF_MISMATCH" ? { code: error.code } : {}),
});
