const DEVICE_ID_KEY = "worshipsync_device_id";
const WORKSTATION_TOKEN_KEY = "worshipsync_workstation_token";
const DISPLAY_TOKEN_KEY = "worshipsync_display_token";
const OPERATOR_NAME_KEY = "worshipsync_operator_name";
/**
 * Per-tab id in sessionStorage. Survives refresh; cleared when the tab/window is gone
 * (new browser session gets a new id). Chrome "restore session" may keep the old id
 * (operator can persist there — acceptable edge case).
 */
const RUNTIME_SESSION_ID_KEY = "worshipsync_runtime_session_id";
/**
 * Binds operator name to RUNTIME_SESSION_ID. When the browser opens a new session,
 * sessionStorage is empty → new runtime id → mismatch → operator cleared without relying
 * on sessionStorage alone (Chrome can restore sessionStorage with restored tabs).
 */
const WORKSTATION_OPERATOR_BINDING_KEY = "worshipsync_workstation_operator_binding";
let csrfToken = "";

export type StoredServerSessionHint = "human" | "workstation" | "display" | null;

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

const readSessionStorage = (key: string) => {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
};

const writeSessionStorage = (key: string, value: string) => {
  if (typeof window === "undefined") return;
  try {
    if (!value) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, value.trim());
  } catch {
    // Quota or privacy mode — leave empty; operator prompt will run again.
  }
};

const createRuntimeSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
};

const getOrCreateRuntimeSessionId = () => {
  let id = readSessionStorage(RUNTIME_SESSION_ID_KEY);
  if (!id) {
    id = createRuntimeSessionId();
    writeSessionStorage(RUNTIME_SESSION_ID_KEY, id);
  }
  return id;
};

type WorkstationOperatorBinding = { runtimeId: string; name: string };

const readWorkstationOperatorBinding = (): WorkstationOperatorBinding | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(WORKSTATION_OPERATOR_BINDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as WorkstationOperatorBinding).runtimeId !== "string" ||
      typeof (parsed as WorkstationOperatorBinding).name !== "string"
    ) {
      return null;
    }
    return parsed as WorkstationOperatorBinding;
  } catch {
    return null;
  }
};

const writeWorkstationOperatorBinding = (binding: WorkstationOperatorBinding | null) => {
  if (typeof window === "undefined") return;
  try {
    if (!binding || !binding.name.trim()) {
      localStorage.removeItem(WORKSTATION_OPERATOR_BINDING_KEY);
      return;
    }
    localStorage.setItem(
      WORKSTATION_OPERATOR_BINDING_KEY,
      JSON.stringify({
        runtimeId: binding.runtimeId,
        name: binding.name.trim(),
      })
    );
  } catch {
    // ignore
  }
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

export const getStoredServerSessionHint = (): StoredServerSessionHint => {
  if (getWorkstationToken()) return "workstation";
  if (getDisplayToken()) return "display";
  if (readStorage("loggedIn") === "true") return "human";
  return null;
};

export const getOperatorName = () => readStorage(OPERATOR_NAME_KEY);
export const setOperatorNameStorage = (value: string) =>
  writeStorage(OPERATOR_NAME_KEY, value.trim());
export const clearOperatorNameStorage = () => writeStorage(OPERATOR_NAME_KEY, "");

/**
 * Who is operating this workstation for this browser session (shared-PC safe).
 * Uses sessionStorage runtime id + localStorage binding so a full browser restart
 * clears the name even when Chrome restores sessionStorage for a tab.
 */
export const getWorkstationSessionOperatorName = () => {
  const runtimeId = getOrCreateRuntimeSessionId();
  const binding = readWorkstationOperatorBinding();
  if (!binding || binding.runtimeId !== runtimeId) {
    return "";
  }
  return binding.name;
};

export const setWorkstationSessionOperatorName = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    clearWorkstationSessionOperatorName();
    return;
  }
  const runtimeId = getOrCreateRuntimeSessionId();
  writeWorkstationOperatorBinding({ runtimeId, name: trimmed });
};

export const clearWorkstationSessionOperatorName = () => {
  writeWorkstationOperatorBinding(null);
  try {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("worshipsync_workstation_operator_session");
    }
  } catch {
    // ignore
  }
};

/** Removes pre–session-scoped operator data left in localStorage by older clients. */
export const clearLegacyWorkstationOperatorName = () =>
  writeStorage(OPERATOR_NAME_KEY, "");

export const getCsrfToken = () => csrfToken;
export const setCsrfToken = (value: string) => {
  csrfToken = value;
};
export const clearCsrfToken = () => {
  csrfToken = "";
};
