export const getChurchRootPath = (churchId?: string | null) =>
  churchId ? `churches/${churchId}` : "";

export const getChurchDataPath = (
  churchId?: string | null,
  ...segments: Array<string | null | undefined>
) => {
  const root = getChurchRootPath(churchId);
  if (!root) return "";
  const suffix = segments.filter(Boolean).join("/");
  return suffix ? `${root}/data/${suffix}` : `${root}/data`;
};
