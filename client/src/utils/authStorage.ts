const DEVICE_ID_KEY = "worshipsync_device_id";
const WORKSTATION_TOKEN_KEY = "worshipsync_workstation_token";
const DISPLAY_TOKEN_KEY = "worshipsync_display_token";
const OPERATOR_NAME_KEY = "worshipsync_operator_name";
let csrfToken = "";

const readStorage = (key: string) => {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(key) || "";
};

const writeStorage = (key: string, value: string) => {
  if (typeof window === "undefined") return;
  if (!value) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, value);
};

export const getOrCreateDeviceId = () => {
  const current = readStorage(DEVICE_ID_KEY);
  if (current) return current;
  const next = crypto.randomUUID();
  writeStorage(DEVICE_ID_KEY, next);
  return next;
};

export const getWorkstationToken = () => readStorage(WORKSTATION_TOKEN_KEY);
export const setWorkstationToken = (value: string) =>
  writeStorage(WORKSTATION_TOKEN_KEY, value);
export const clearWorkstationToken = () => writeStorage(WORKSTATION_TOKEN_KEY, "");

export const getDisplayToken = () => readStorage(DISPLAY_TOKEN_KEY);
export const setDisplayToken = (value: string) =>
  writeStorage(DISPLAY_TOKEN_KEY, value);
export const clearDisplayToken = () => writeStorage(DISPLAY_TOKEN_KEY, "");

export const getOperatorName = () => readStorage(OPERATOR_NAME_KEY);
export const setOperatorNameStorage = (value: string) =>
  writeStorage(OPERATOR_NAME_KEY, value.trim());
export const clearOperatorNameStorage = () => writeStorage(OPERATOR_NAME_KEY, "");

export const getCsrfToken = () => csrfToken;
export const setCsrfToken = (value: string) => {
  csrfToken = value;
};
export const clearCsrfToken = () => {
  csrfToken = "";
};
