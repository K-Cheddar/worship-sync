import {
  clearCsrfToken,
  clearDisplayToken,
  clearHumanApiToken,
  clearLegacyWorkstationOperatorName,
  clearWorkstationToken,
  clearWorkstationSessionOperatorName,
  consumePendingEmailCodeSignInMethod,
  getCsrfToken,
  getDisplayToken,
  getHumanApiToken,
  getLastSignInMethod,
  getOrCreateDeviceId,
  getPendingDesktopAuthState,
  getPendingDesktopEmailResendState,
  getPendingLinkCredentialState,
  getPendingLinkState,
  getStoredServerSessionHint,
  getWorkstationSessionOperatorName,
  getWorkstationToken,
  inferLastSignInMethodFromProviderIds,
  setCsrfToken,
  setDisplayToken,
  setHumanApiToken,
  setLastSignInMethod,
  setPendingDesktopAuthState,
  setPendingDesktopEmailResendState,
  setPendingEmailCodeSignInMethod,
  setPendingLinkCredentialState,
  setPendingLinkState,
  setWorkstationToken,
  setWorkstationSessionOperatorName,
} from "./authStorage";

const RUNTIME_SESSION_ID_KEY = "worshipsync_runtime_session_id";
const WORKSTATION_OPERATOR_BINDING_KEY =
  "worshipsync_workstation_operator_binding";
const OPERATOR_NAME_KEY = "worshipsync_operator_name";

const memoryStorage = () => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach((k) => {
        delete store[k];
      });
    },
    _store: store,
  };
};

describe("authStorage workstation session operator", () => {
  let localMock: ReturnType<typeof memoryStorage>;
  let sessionMock: ReturnType<typeof memoryStorage>;
  let uuidCount = 0;

  beforeEach(() => {
    localMock = memoryStorage();
    sessionMock = memoryStorage();
    uuidCount = 0;
    Object.defineProperty(window, "localStorage", {
      value: localMock,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, "sessionStorage", {
      value: sessionMock,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "crypto", {
      value: {
        randomUUID: () => `test-runtime-${++uuidCount}`,
      },
      configurable: true,
    });
  });

  it("returns empty when no binding exists", () => {
    expect(getWorkstationSessionOperatorName()).toBe("");
  });

  it("persists the operator name for the current runtime session", () => {
    setWorkstationSessionOperatorName("  Alex  ");
    expect(getWorkstationSessionOperatorName()).toBe("Alex");
    expect(sessionMock.getItem(RUNTIME_SESSION_ID_KEY)).toBeTruthy();
    const raw = localMock.getItem(WORKSTATION_OPERATOR_BINDING_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toEqual({
      runtimeId: "test-runtime-1",
      name: "Alex",
    });
  });

  it("clears the name when session runtime id changes (new browser session)", () => {
    setWorkstationSessionOperatorName("Sam");
    expect(getWorkstationSessionOperatorName()).toBe("Sam");
    sessionMock.clear();
    expect(getWorkstationSessionOperatorName()).toBe("");
  });

  it("clears binding when set to empty string", () => {
    setWorkstationSessionOperatorName("Pat");
    setWorkstationSessionOperatorName("");
    expect(getWorkstationSessionOperatorName()).toBe("");
    expect(localMock.getItem(WORKSTATION_OPERATOR_BINDING_KEY)).toBeNull();
  });

  it("clearWorkstationSessionOperatorName removes binding and legacy session key", () => {
    setWorkstationSessionOperatorName("Jo");
    sessionMock.setItem("worshipsync_workstation_operator_session", "legacy");
    clearWorkstationSessionOperatorName();
    expect(getWorkstationSessionOperatorName()).toBe("");
    expect(localMock.getItem(WORKSTATION_OPERATOR_BINDING_KEY)).toBeNull();
    expect(
      sessionMock.getItem("worshipsync_workstation_operator_session"),
    ).toBeNull();
  });

  it("clearLegacyWorkstationOperatorName removes legacy operator key", () => {
    localMock.setItem(OPERATOR_NAME_KEY, "OldName");
    clearLegacyWorkstationOperatorName();
    expect(localMock.getItem(OPERATOR_NAME_KEY)).toBeNull();
  });

  it("rejects malformed binding JSON", () => {
    localMock.setItem(WORKSTATION_OPERATOR_BINDING_KEY, "not-json");
    expect(getWorkstationSessionOperatorName()).toBe("");
  });
});

describe("authStorage pending email code sign-in method", () => {
  let sessionMock: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    sessionMock = memoryStorage();
    Object.defineProperty(window, "sessionStorage", {
      value: sessionMock,
      configurable: true,
      writable: true,
    });
  });

  it("stores and consumes a pending method", () => {
    setPendingEmailCodeSignInMethod("google");
    expect(consumePendingEmailCodeSignInMethod()).toBe("google");
    expect(consumePendingEmailCodeSignInMethod()).toBeNull();
  });

  it("clears pending method when set to null", () => {
    setPendingEmailCodeSignInMethod("microsoft");
    setPendingEmailCodeSignInMethod(null);
    expect(consumePendingEmailCodeSignInMethod()).toBeNull();
  });

  it("maps Firebase provider ids to stored method keys", () => {
    expect(inferLastSignInMethodFromProviderIds(["password"])).toBe("password");
    expect(
      inferLastSignInMethodFromProviderIds(["google.com", "password"]),
    ).toBe("google");
    expect(inferLastSignInMethodFromProviderIds(["microsoft.com"])).toBe(
      "microsoft",
    );
  });
});

describe("authStorage desktop email resend handshake", () => {
  let sessionMock: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    sessionMock = memoryStorage();
    Object.defineProperty(window, "sessionStorage", {
      value: sessionMock,
      configurable: true,
      writable: true,
    });
  });

  it("stores and reads desktop auth id and secret", () => {
    setPendingDesktopEmailResendState({
      desktopAuthId: " id-1 ",
      desktopAuthSecret: " secret-1 ",
    });
    expect(getPendingDesktopEmailResendState()).toEqual({
      desktopAuthId: "id-1",
      desktopAuthSecret: "secret-1",
    });
  });

  it("clears when set to null", () => {
    setPendingDesktopEmailResendState({
      desktopAuthId: "a",
      desktopAuthSecret: "b",
    });
    setPendingDesktopEmailResendState(null);
    expect(getPendingDesktopEmailResendState()).toBeNull();
  });
});

const HUMAN_API_TOKEN_KEY = "worshipsync_human_api_token";

describe("authStorage human API token", () => {
  let localMock: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    localMock = memoryStorage();
    Object.defineProperty(window, "localStorage", {
      value: localMock,
      configurable: true,
      writable: true,
    });
  });

  it("stores and reads human API token", () => {
    setHumanApiToken("wsh_test_token");
    expect(getHumanApiToken()).toBe("wsh_test_token");
    expect(localMock.getItem(HUMAN_API_TOKEN_KEY)).toBe("wsh_test_token");
    clearHumanApiToken();
    expect(getHumanApiToken()).toBe("");
    expect(localMock.getItem(HUMAN_API_TOKEN_KEY)).toBeNull();
  });
});

describe("authStorage last sign-in method", () => {
  let localMock: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    localMock = memoryStorage();
    Object.defineProperty(window, "localStorage", {
      value: localMock,
      configurable: true,
      writable: true,
    });
  });

  it("returns null when nothing is stored", () => {
    expect(getLastSignInMethod()).toBeNull();
  });

  it("stores and retrieves each valid method", () => {
    setLastSignInMethod("google");
    expect(getLastSignInMethod()).toBe("google");
    setLastSignInMethod("microsoft");
    expect(getLastSignInMethod()).toBe("microsoft");
    setLastSignInMethod("password");
    expect(getLastSignInMethod()).toBe("password");
  });

  it("returns null for unrecognised stored value", () => {
    localMock.setItem("worshipsync_last_sign_in_method", "other");
    expect(getLastSignInMethod()).toBeNull();
  });
});

describe("authStorage workstation and display tokens", () => {
  let localMock: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    localMock = memoryStorage();
    Object.defineProperty(window, "localStorage", {
      value: localMock,
      configurable: true,
      writable: true,
    });
  });

  it("workstation token: set, get, clear", () => {
    setWorkstationToken("ws-abc");
    expect(getWorkstationToken()).toBe("ws-abc");
    clearWorkstationToken();
    expect(getWorkstationToken()).toBe("");
  });

  it("display token: set, get, clear", () => {
    setDisplayToken("disp-abc");
    expect(getDisplayToken()).toBe("disp-abc");
    clearDisplayToken();
    expect(getDisplayToken()).toBe("");
  });
});

describe("authStorage getStoredServerSessionHint", () => {
  let localMock: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    localMock = memoryStorage();
    Object.defineProperty(window, "localStorage", {
      value: localMock,
      configurable: true,
      writable: true,
    });
  });

  it("returns workstation when workstation token is present", () => {
    setWorkstationToken("ws-tok");
    expect(getStoredServerSessionHint()).toBe("workstation");
  });

  it("returns display when only display token is present", () => {
    setDisplayToken("disp-tok");
    expect(getStoredServerSessionHint()).toBe("display");
  });

  it("returns human when loggedIn=true and no tokens", () => {
    localMock.setItem("loggedIn", "true");
    expect(getStoredServerSessionHint()).toBe("human");
  });

  it("returns null when nothing is set", () => {
    expect(getStoredServerSessionHint()).toBeNull();
  });
});

describe("authStorage CSRF token", () => {
  afterEach(() => {
    clearCsrfToken();
  });

  it("returns empty string by default", () => {
    expect(getCsrfToken()).toBe("");
  });

  it("set and get CSRF token", () => {
    setCsrfToken("csrf-xyz");
    expect(getCsrfToken()).toBe("csrf-xyz");
  });

  it("clearCsrfToken resets to empty string", () => {
    setCsrfToken("token");
    clearCsrfToken();
    expect(getCsrfToken()).toBe("");
  });
});

describe("authStorage device ID", () => {
  let localMock: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    localMock = memoryStorage();
    Object.defineProperty(window, "localStorage", {
      value: localMock,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: () => "device-uuid-123" },
      configurable: true,
    });
  });

  it("creates and returns a device id when none exists", () => {
    const id = getOrCreateDeviceId();
    expect(id).toBe("device-uuid-123");
  });

  it("returns the same id on subsequent calls", () => {
    getOrCreateDeviceId();
    const second = getOrCreateDeviceId();
    expect(second).toBe("device-uuid-123");
  });
});

describe("authStorage pending link state", () => {
  let sessionMock: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    sessionMock = memoryStorage();
    Object.defineProperty(window, "sessionStorage", {
      value: sessionMock,
      configurable: true,
      writable: true,
    });
  });

  it("returns null when nothing is stored", () => {
    expect(getPendingLinkState()).toBeNull();
  });

  it("stores and retrieves a valid google link state", () => {
    setPendingLinkState({
      email: "  user@example.com  ",
      providerId: "google.com",
      requiredMethods: ["google.com", "password"],
    });
    const state = getPendingLinkState();
    expect(state?.email).toBe("user@example.com");
    expect(state?.providerId).toBe("google.com");
    expect(state?.requiredMethods).toContain("google.com");
  });

  it("stores and retrieves a valid microsoft link state", () => {
    setPendingLinkState({
      email: "user@corp.com",
      providerId: "microsoft.com",
      requiredMethods: [],
    });
    expect(getPendingLinkState()?.providerId).toBe("microsoft.com");
  });

  it("clears storage when called with null", () => {
    setPendingLinkState({ email: "x@y.com", providerId: "google.com", requiredMethods: [] });
    setPendingLinkState(null);
    expect(getPendingLinkState()).toBeNull();
  });

  it("returns null for invalid stored JSON", () => {
    sessionMock.setItem("worshipsync_pending_link_state", "{invalid}");
    expect(getPendingLinkState()).toBeNull();
  });

  it("returns null when providerId is invalid", () => {
    sessionMock.setItem(
      "worshipsync_pending_link_state",
      JSON.stringify({ email: "x@y.com", providerId: "unknown", requiredMethods: [] }),
    );
    expect(getPendingLinkState()).toBeNull();
  });
});

describe("authStorage pending link credential state", () => {
  let sessionMock: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    sessionMock = memoryStorage();
    Object.defineProperty(window, "sessionStorage", {
      value: sessionMock,
      configurable: true,
      writable: true,
    });
  });

  it("returns null when nothing is stored", () => {
    expect(getPendingLinkCredentialState()).toBeNull();
  });

  it("stores and retrieves with object credential", () => {
    setPendingLinkCredentialState({ providerId: "google.com", credentialJson: { token: "t" } });
    const state = getPendingLinkCredentialState();
    expect(state?.providerId).toBe("google.com");
    expect(state?.credentialJson).toEqual({ token: "t" });
  });

  it("stores and retrieves with string credential", () => {
    setPendingLinkCredentialState({ providerId: "microsoft.com", credentialJson: "raw-cred" });
    expect(getPendingLinkCredentialState()?.credentialJson).toBe("raw-cred");
  });

  it("clears storage when called with null", () => {
    setPendingLinkCredentialState({ providerId: "google.com", credentialJson: {} });
    setPendingLinkCredentialState(null);
    expect(getPendingLinkCredentialState()).toBeNull();
  });

  it("returns null for invalid providerId", () => {
    sessionMock.setItem(
      "worshipsync_pending_link_credential",
      JSON.stringify({ providerId: "bad.com", credentialJson: "x" }),
    );
    expect(getPendingLinkCredentialState()).toBeNull();
  });
});

describe("authStorage pending desktop auth state", () => {
  let sessionMock: ReturnType<typeof memoryStorage>;
  const validState = {
    desktopAuthId: "auth-id",
    desktopAuthSecret: "secret",
    provider: "google" as const,
    browserUrl: "https://example.com",
    expiresAt: "2030-01-01T00:00:00Z",
    pollIntervalMs: 3000,
  };

  beforeEach(() => {
    sessionMock = memoryStorage();
    Object.defineProperty(window, "sessionStorage", {
      value: sessionMock,
      configurable: true,
      writable: true,
    });
  });

  it("returns null when nothing is stored", () => {
    expect(getPendingDesktopAuthState()).toBeNull();
  });

  it("stores and retrieves valid google state", () => {
    setPendingDesktopAuthState(validState);
    const state = getPendingDesktopAuthState();
    expect(state?.desktopAuthId).toBe("auth-id");
    expect(state?.provider).toBe("google");
    expect(state?.pollIntervalMs).toBe(3000);
  });

  it("stores and retrieves valid microsoft state", () => {
    setPendingDesktopAuthState({ ...validState, provider: "microsoft" });
    expect(getPendingDesktopAuthState()?.provider).toBe("microsoft");
  });

  it("clears storage when called with null", () => {
    setPendingDesktopAuthState(validState);
    setPendingDesktopAuthState(null);
    expect(getPendingDesktopAuthState()).toBeNull();
  });

  it("returns null when provider is invalid", () => {
    sessionMock.setItem(
      "worshipsync_pending_desktop_auth",
      JSON.stringify({ ...validState, provider: "apple" }),
    );
    expect(getPendingDesktopAuthState()).toBeNull();
  });

  it("returns null when desktopAuthId is not a string", () => {
    sessionMock.setItem(
      "worshipsync_pending_desktop_auth",
      JSON.stringify({ ...validState, desktopAuthId: 42 }),
    );
    expect(getPendingDesktopAuthState()).toBeNull();
  });
});
