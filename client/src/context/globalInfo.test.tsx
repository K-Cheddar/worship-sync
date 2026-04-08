import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useContext } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import GlobalInfoProvider from "./globalInfo";
import { GlobalInfoContext } from "./globalInfo";
import * as authApi from "../api/auth";
import * as firebaseApps from "../firebase/apps";
import {
  getWorkstationSessionOperatorName,
  setWorkstationSessionOperatorName,
} from "../utils/authStorage";

const mockDispatch = jest.fn();
const onValueCallbacks = new Map<string, (snapshot: any) => void>();

const refMock = jest.fn(
  (_db: unknown, path: string) =>
    ({
      path,
    }) as { path: string }
);
const onValueMock = jest.fn(
  (target: { path: string }, callback: (snapshot: any) => void) => {
    onValueCallbacks.set(target.path, callback);
    return jest.fn();
  }
);
const setMock = jest.fn();
const getDatabaseMock = jest.fn(() => ({ name: "firebase-db" }));
const signInWithCustomTokenMock = jest.fn(() => Promise.resolve({}));
const signOutMock = jest.fn(() => Promise.resolve());

jest.mock("../hooks", () => ({
  useDispatch: () => mockDispatch,
}));

jest.mock("../api/auth", () => ({
  AuthApiError: class MockAuthApiError extends Error {
    isReachabilityError: boolean;

    constructor(message: string, options?: { isReachabilityError?: boolean }) {
      super(message);
      this.name = "AuthApiError";
      this.isReachabilityError = Boolean(options?.isReachabilityError);
    }
  },
  getAuthBootstrap: jest.fn(),
  getSharedDataToken: jest.fn(() =>
    Promise.resolve({ success: true, token: "test-token", database: "main" })
  ),
  createHumanSession: jest.fn(),
  createChurchAccount: jest.fn(),
  forgotPassword: jest.fn(),
  logoutSession: jest.fn(),
  unlinkWorkstation: jest.fn(() => Promise.resolve({ success: true })),
  verifyEmailCode: jest.fn(),
  updateWorkstationOperator: jest.fn(() =>
    Promise.resolve({ success: true, workstation: {} })
  ),
}));

jest.mock("../firebase/apps", () => ({
  getHumanAuth: jest.fn(() => ({})),
  getSharedDataAuth: jest.fn(() => ({})),
  getSharedDataDatabase: jest.fn(() => ({ name: "firebase-db" })),
}));

jest.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    const unsubscribe = jest.fn();
    Promise.resolve().then(() => callback(null));
    return unsubscribe;
  },
  signInWithCustomToken: (...args: any[]) =>
    signInWithCustomTokenMock(...args),
  signInWithEmailAndPassword: jest.fn(() => Promise.resolve({})),
  signOut: (...args: any[]) => signOutMock(...args),
  createUserWithEmailAndPassword: jest.fn(() => Promise.resolve({ user: {} })),
  updateProfile: jest.fn(() => Promise.resolve()),
}));

jest.mock("firebase/database", () => ({
  ref: (...args: any[]) => refMock(...args),
  onValue: (...args: any[]) => onValueMock(...args),
  set: (...args: any[]) => setMock(...args),
  onDisconnect: jest.fn(() => ({
    remove: jest.fn(),
  })),
}));

const demoBootstrap = { authenticated: false as const };

const loggedInHumanBootstrap = {
  authenticated: true as const,
  sessionKind: "human" as const,
  database: "main",
  uploadPreset: "bpqu4ma5",
  appAccess: "full",
  churchId: "church-1",
  churchName: "Test Church",
  churchStatus: "active" as const,
  recoveryEmail: "",
  role: "admin",
  user: {
    uid: "u1",
    email: "test@example.com",
    displayName: "Test User",
  },
  device: null,
  csrfToken: "csrf-test",
};

const loggedInWorkstationBootstrap = {
  authenticated: true as const,
  sessionKind: "workstation" as const,
  database: "main",
  uploadPreset: "bpqu4ma5",
  appAccess: "full",
  churchId: "church-1",
  churchName: "Test Church",
  churchStatus: "active" as const,
  recoveryEmail: "",
  role: "member",
  user: null,
  device: {
    deviceId: "workstation-1",
    label: "Front Row Laptop",
    operatorName: "Alex",
  },
  csrfToken: "csrf-test",
};

const renderProvider = (
  child: ReactNode = <div>child</div>,
  initialEntries = ["/controller"]
) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <GlobalInfoProvider>
        {child}
      </GlobalInfoProvider>
    </MemoryRouter>
  );

const snapshotFor = (value: any) => ({
  exists: () => value !== undefined && value !== null,
  val: () => value,
});

const makeReachabilityError = (message = "offline") => {
  const AuthApiErrorCtor = authApi.AuthApiError as unknown as new (
    message: string,
    options?: { isReachabilityError?: boolean }
  ) => Error;
  return new AuthApiErrorCtor(message, { isReachabilityError: true });
};

const ContextProbe = () => {
  const context = useContext(GlobalInfoContext);
  const location = useLocation();

  if (!context) return null;

  return (
    <div>
      <div data-testid="session-kind">{context.sessionKind || "none"}</div>
      <div data-testid="operator-name">{context.operatorName || "none"}</div>
      <div data-testid="auth-status">{context.authServerStatus}</div>
      <div data-testid="user-name">{context.user || "none"}</div>
      <div data-testid="path">{location.pathname}</div>
      <button type="button" onClick={() => void context.refreshAuthBootstrap()}>
        Refresh bootstrap
      </button>
      <button
        type="button"
        onClick={() => void context.endWorkstationOperatorSession()}
      >
        End workstation session
      </button>
      <button
        type="button"
        onClick={() => void context.unlinkCurrentWorkstation()}
      >
        Unlink workstation
      </button>
    </div>
  );
};

describe("GlobalInfoProvider presentation listener contracts", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockDispatch.mockClear();
    onValueCallbacks.clear();
    refMock.mockClear();
    onValueMock.mockClear();
    setMock.mockClear();
    signInWithCustomTokenMock.mockClear();
    signOutMock.mockClear();
    (authApi.getAuthBootstrap as jest.Mock).mockReset();
    (authApi.unlinkWorkstation as jest.Mock).mockReset();
    (authApi.updateWorkstationOperator as jest.Mock).mockReset();
    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(demoBootstrap);
    (authApi.unlinkWorkstation as jest.Mock).mockResolvedValue({
      success: true,
    });
    (authApi.updateWorkstationOperator as jest.Mock).mockResolvedValue({
      success: true,
      workstation: {},
    });
    (firebaseApps.getSharedDataDatabase as jest.Mock).mockImplementation(() =>
      getDatabaseMock()
    );
    (firebaseApps.getSharedDataDatabase as jest.Mock).mockClear();
  });

  it("routes storage updates to the current debounced projector, monitor, and stream actions", async () => {
    renderProvider();

    const projectorInfo = { name: "Stored Projector", time: 101 };
    const monitorInfo = { name: "Stored Monitor", time: 202 };
    const streamInfo = { name: "Stored Stream", time: 303 };

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "projectorInfo",
        newValue: JSON.stringify(projectorInfo),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "monitorInfo",
        newValue: JSON.stringify(monitorInfo),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "streamInfo",
        newValue: JSON.stringify(streamInfo),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_itemContentBlocked",
        newValue: JSON.stringify(false),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "not_a_screen_key",
        newValue: JSON.stringify({ ignored: true }),
      })
    );

    await waitFor(() =>
      expect(mockDispatch.mock.calls).toEqual(
        expect.arrayContaining([
          [
            {
              type: "debouncedUpdateProjector",
              payload: projectorInfo,
            },
          ],
          [
            {
              type: "debouncedUpdateMonitor",
              payload: monitorInfo,
            },
          ],
          [
            {
              type: "debouncedUpdateStream",
              payload: streamInfo,
            },
          ],
          [
            {
              type: "debouncedUpdateStreamItemContentBlocked",
              payload: false,
            },
          ],
        ])
      )
    );
    expect(mockDispatch).toHaveBeenCalledTimes(4);
  });

  it("subscribes to the default presentation listener keys and dispatches their debounced actions", async () => {
    localStorage.setItem("loggedIn", "true");
    localStorage.setItem("user", "Test User");
    localStorage.setItem("database", "main");

    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(loggedInHumanBootstrap);

    renderProvider();

    await waitFor(() =>
      expect(firebaseApps.getSharedDataDatabase).toHaveBeenCalled()
    );
    await waitFor(() =>
      expect(onValueCallbacks.has("churches/church-1/data/presentation/projectorInfo")).toBe(
        true
      )
    );

    expect(onValueCallbacks.has("churches/church-1/data/presentation/monitorInfo")).toBe(
      true
    );
    expect(onValueCallbacks.has("churches/church-1/data/presentation/streamInfo")).toBe(
      true
    );
    expect(
      onValueCallbacks.has("churches/church-1/data/presentation/stream_itemContentBlocked")
    ).toBe(true);

    mockDispatch.mockClear();

    onValueCallbacks
      .get("churches/church-1/data/presentation/projectorInfo")
      ?.(snapshotFor({ name: "Remote Projector", time: 500 }));
    onValueCallbacks
      .get("churches/church-1/data/presentation/monitorInfo")
      ?.(snapshotFor({ name: "Remote Monitor", time: 600 }));
    onValueCallbacks
      .get("churches/church-1/data/presentation/streamInfo")
      ?.(snapshotFor({ name: "Remote Stream", time: 700 }));
    onValueCallbacks
      .get("churches/church-1/data/presentation/stream_itemContentBlocked")
      ?.(snapshotFor(true));

    await waitFor(() =>
      expect(mockDispatch.mock.calls).toEqual(
        expect.arrayContaining([
          [
            {
              type: "debouncedUpdateProjector",
              payload: { name: "Remote Projector", time: 500 },
            },
          ],
          [
            {
              type: "debouncedUpdateMonitor",
              payload: { name: "Remote Monitor", time: 600 },
            },
          ],
          [
            {
              type: "debouncedUpdateStream",
              payload: { name: "Remote Stream", time: 700 },
            },
          ],
          [
            {
              type: "debouncedUpdateStreamItemContentBlocked",
              payload: true,
            },
          ],
        ])
      )
    );
  });

  it("routes legacy stream subkeys from storage and Firebase to the current debounced actions", async () => {
    localStorage.setItem("loggedIn", "true");
    localStorage.setItem("user", "Test User");
    localStorage.setItem("database", "main");

    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(loggedInHumanBootstrap);

    renderProvider();

    const bibleInfo = { title: "John 3:16", time: 1001 };
    const participantOverlay = { name: "Alex", time: 1002 };
    const stbOverlay = { heading: "Now Playing", time: 1003 };
    const qrOverlay = { description: "Scan Here", time: 1004 };
    const imageOverlay = { imageUrl: "image.jpg", time: 1005 };
    const formattedText = { text: "Formatted", time: 1006 };

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_bibleInfo",
        newValue: JSON.stringify(bibleInfo),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_participantOverlayInfo",
        newValue: JSON.stringify(participantOverlay),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_stbOverlayInfo",
        newValue: JSON.stringify(stbOverlay),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_qrCodeOverlayInfo",
        newValue: JSON.stringify(qrOverlay),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_imageOverlayInfo",
        newValue: JSON.stringify(imageOverlay),
      })
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "stream_formattedTextDisplayInfo",
        newValue: JSON.stringify(formattedText),
      })
    );

    await waitFor(() =>
      expect(mockDispatch.mock.calls).toEqual(
        expect.arrayContaining([
          [{ type: "debouncedUpdateBibleDisplayInfo", payload: bibleInfo }],
          [
            {
              type: "debouncedUpdateParticipantOverlayInfo",
              payload: participantOverlay,
            },
          ],
          [{ type: "debouncedUpdateStbOverlayInfo", payload: stbOverlay }],
          [{ type: "debouncedUpdateQrCodeOverlayInfo", payload: qrOverlay }],
          [{ type: "debouncedUpdateImageOverlayInfo", payload: imageOverlay }],
          [
            {
              type: "debouncedUpdateFormattedTextDisplayInfo",
              payload: formattedText,
            },
          ],
        ])
      )
    );

    await waitFor(() =>
      expect(
        onValueCallbacks.has("churches/church-1/data/presentation/stream_bibleInfo")
      ).toBe(true)
    );
    expect(
      onValueCallbacks.has("churches/church-1/data/presentation/stream_participantOverlayInfo")
    ).toBe(true);
    expect(
      onValueCallbacks.has("churches/church-1/data/presentation/stream_stbOverlayInfo")
    ).toBe(true);
    expect(
      onValueCallbacks.has("churches/church-1/data/presentation/stream_qrCodeOverlayInfo")
    ).toBe(true);
    expect(
      onValueCallbacks.has("churches/church-1/data/presentation/stream_imageOverlayInfo")
    ).toBe(true);
    expect(
      onValueCallbacks.has(
        "churches/church-1/data/presentation/stream_formattedTextDisplayInfo"
      )
    ).toBe(true);

    mockDispatch.mockClear();

    onValueCallbacks
      .get("churches/church-1/data/presentation/stream_bibleInfo")
      ?.(snapshotFor(bibleInfo));
    onValueCallbacks
      .get("churches/church-1/data/presentation/stream_participantOverlayInfo")
      ?.(snapshotFor(participantOverlay));
    onValueCallbacks
      .get("churches/church-1/data/presentation/stream_stbOverlayInfo")
      ?.(snapshotFor(stbOverlay));
    onValueCallbacks
      .get("churches/church-1/data/presentation/stream_qrCodeOverlayInfo")
      ?.(snapshotFor(qrOverlay));
    onValueCallbacks
      .get("churches/church-1/data/presentation/stream_imageOverlayInfo")
      ?.(snapshotFor(imageOverlay));
    onValueCallbacks
      .get("churches/church-1/data/presentation/stream_formattedTextDisplayInfo")
      ?.(snapshotFor(formattedText));

    await waitFor(() =>
      expect(mockDispatch.mock.calls).toEqual(
        expect.arrayContaining([
          [{ type: "debouncedUpdateBibleDisplayInfo", payload: bibleInfo }],
          [
            {
              type: "debouncedUpdateParticipantOverlayInfo",
              payload: participantOverlay,
            },
          ],
          [{ type: "debouncedUpdateStbOverlayInfo", payload: stbOverlay }],
          [{ type: "debouncedUpdateQrCodeOverlayInfo", payload: qrOverlay }],
          [{ type: "debouncedUpdateImageOverlayInfo", payload: imageOverlay }],
          [
            {
              type: "debouncedUpdateFormattedTextDisplayInfo",
              payload: formattedText,
            },
          ],
        ])
      )
    );
  });

  it("keeps the current workstation session during an offline bootstrap retry", async () => {
    setWorkstationSessionOperatorName("Alex");
    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValueOnce(
      loggedInWorkstationBootstrap
    );
    (authApi.getAuthBootstrap as jest.Mock).mockRejectedValue(
      makeReachabilityError()
    );

    renderProvider(<ContextProbe />);

    await waitFor(() =>
      expect(screen.getByTestId("session-kind")).toHaveTextContent("workstation")
    );
    expect(screen.getByTestId("operator-name")).toHaveTextContent("Alex");

    fireEvent.click(screen.getByRole("button", { name: "Refresh bootstrap" }));

    await waitFor(() =>
      expect(screen.getByTestId("auth-status")).toHaveTextContent("checking")
    );
    expect(screen.getByTestId("session-kind")).toHaveTextContent("workstation");
    expect(screen.getByTestId("operator-name")).toHaveTextContent("Alex");
    expect(getWorkstationSessionOperatorName()).toBe("Alex");
  });

  it("navigates to operator handoff immediately even when the server clear fails", async () => {
    setWorkstationSessionOperatorName("Alex");
    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValueOnce(
      loggedInWorkstationBootstrap
    );
    (authApi.updateWorkstationOperator as jest.Mock).mockRejectedValueOnce(
      makeReachabilityError()
    );

    renderProvider(<ContextProbe />);

    await waitFor(() =>
      expect(screen.getByTestId("session-kind")).toHaveTextContent("workstation")
    );

    fireEvent.click(
      screen.getByRole("button", { name: "End workstation session" })
    );

    await waitFor(() =>
      expect(screen.getByTestId("path")).toHaveTextContent("/workstation/operator")
    );
    expect(screen.getByTestId("session-kind")).toHaveTextContent("workstation");
    expect(screen.getByTestId("operator-name")).toHaveTextContent("none");
    expect(screen.getByTestId("user-name")).toHaveTextContent("Front Row Laptop");
    expect(getWorkstationSessionOperatorName()).toBe("");
  });

  it("clears the workstation operator when the server confirms the session is gone", async () => {
    setWorkstationSessionOperatorName("Alex");
    (authApi.getAuthBootstrap as jest.Mock)
      .mockResolvedValueOnce(loggedInWorkstationBootstrap)
      .mockResolvedValueOnce(demoBootstrap);

    renderProvider(<ContextProbe />);

    await waitFor(() =>
      expect(screen.getByTestId("session-kind")).toHaveTextContent("workstation")
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh bootstrap" }));

    await waitFor(() =>
      expect(screen.getByTestId("session-kind")).toHaveTextContent("none")
    );
    expect(getWorkstationSessionOperatorName()).toBe("");
  });

  it("unlinks the current workstation and clears local auth state", async () => {
    setWorkstationSessionOperatorName("Alex");
    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValueOnce(
      loggedInWorkstationBootstrap
    );

    renderProvider(<ContextProbe />, ["/workstation/operator"]);

    await waitFor(() =>
      expect(screen.getByTestId("session-kind")).toHaveTextContent("workstation")
    );

    fireEvent.click(screen.getByRole("button", { name: "Unlink workstation" }));

    await waitFor(() =>
      expect(screen.getByTestId("path")).toHaveTextContent("/")
    );
    expect(authApi.unlinkWorkstation).toHaveBeenCalledWith("workstation-1", "");
    expect(screen.getByTestId("session-kind")).toHaveTextContent("none");
    expect(getWorkstationSessionOperatorName()).toBe("");
  });
});
