import {
  clearLegacyWorkstationOperatorName,
  clearWorkstationSessionOperatorName,
  getWorkstationSessionOperatorName,
  setWorkstationSessionOperatorName,
} from "./authStorage";

const RUNTIME_SESSION_ID_KEY = "worshipsync_runtime_session_id";
const WORKSTATION_OPERATOR_BINDING_KEY = "worshipsync_workstation_operator_binding";
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
    expect(sessionMock.getItem("worshipsync_workstation_operator_session")).toBeNull();
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
