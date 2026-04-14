import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useContext } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import GlobalInfoProvider from "./globalInfo";
import { GlobalInfoContext } from "./globalInfo";
import * as authApi from "../api/auth";
import * as firebaseApps from "../firebase/apps";
import {
  getPendingLinkCredentialState,
  getPendingLinkState,
  setPendingLinkCredentialState,
  setPendingLinkState,
  getWorkstationSessionOperatorName,
  setWorkstationSessionOperatorName,
} from "../utils/authStorage";

const mockDispatch = jest.fn();
const onValueCallbacks = new Map<string, (snapshot: any) => void>();
const onValueErrorCallbacks = new Map<string, (error: unknown) => void>();

const refMock = jest.fn(
  (_db: unknown, path: string) =>
    ({
      path,
    }) as { path: string }
);
const onValueMock = jest.fn(
  (
    target: { path: string },
    callback: (snapshot: any) => void,
    onError?: (error: unknown) => void
  ) => {
    onValueCallbacks.set(target.path, callback);
    if (onError) {
      onValueErrorCallbacks.set(target.path, onError);
    }
    return jest.fn();
  }
);
const setMock = jest.fn();
const getDatabaseMock = jest.fn(() => ({ name: "firebase-db" }));
const signInWithCustomTokenMock = jest.fn<any, any[]>(() => Promise.resolve({}));
const signOutMock = jest.fn<any, any[]>(() => Promise.resolve());
const signInWithEmailAndPasswordMock = jest.fn<any, any[]>(() => Promise.resolve({}));
const signInWithPopupMock = jest.fn<any, any[]>(() => Promise.resolve({}));
const fetchSignInMethodsForEmailMock = jest.fn<any, any[]>(() => Promise.resolve([]));
const linkWithCredentialMock = jest.fn<any, any[]>(() => Promise.resolve({}));
const updateProfileMock = jest.fn<any, any[]>(() => Promise.resolve());
const googleCredentialFromErrorMock = jest.fn<any, any[]>();
const googleCredentialFactoryMock = jest.fn(
  (idToken?: string | null, accessToken?: string | null) => ({
    providerId: "google.com",
    signInMethod: "google.com",
    idToken,
    accessToken,
    toJSON: () => ({
      oauthIdToken: idToken,
      oauthAccessToken: accessToken,
    }),
  }),
);
const microsoftCredentialFromErrorMock = jest.fn<any, any[]>();
const mockHumanAuth = {
  currentUser: null as any,
};

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
  getHumanAuth: jest.fn(() => mockHumanAuth),
  getSharedDataAuth: jest.fn(() => ({})),
  getSharedDataDatabase: jest.fn(() => ({ name: "firebase-db" })),
}));

jest.mock("firebase/auth", () => ({
  GoogleAuthProvider: Object.assign(
    jest.fn(() => ({
      providerId: "google.com",
    })),
    {
      credentialFromError: (...args: unknown[]) =>
        googleCredentialFromErrorMock(...args),
      credential: (
        idToken?: string | null,
        accessToken?: string | null,
      ) => googleCredentialFactoryMock(idToken, accessToken),
    },
  ),
  OAuthProvider: Object.assign(
    jest.fn((providerId: string) => ({
      providerId,
      setCustomParameters: jest.fn(),
      credential: (
        optionsOrIdToken: { idToken?: string; accessToken?: string } | string | null,
        accessToken?: string,
      ) => ({
        providerId,
        signInMethod: providerId,
        optionsOrIdToken,
        accessToken,
        toJSON: () => ({
          oauthIdToken:
            typeof optionsOrIdToken === "object" && optionsOrIdToken
              ? optionsOrIdToken.idToken
              : "",
          oauthAccessToken:
            typeof optionsOrIdToken === "object" && optionsOrIdToken
              ? optionsOrIdToken.accessToken
              : accessToken,
        }),
      }),
    })),
    {
      credentialFromError: (...args: unknown[]) =>
        microsoftCredentialFromErrorMock(...args),
    },
  ),
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => {
    const unsubscribe = jest.fn();
    Promise.resolve().then(() => callback(mockHumanAuth.currentUser));
    return unsubscribe;
  },
  fetchSignInMethodsForEmail: (auth: unknown, email: string) =>
    fetchSignInMethodsForEmailMock(auth, email),
  linkWithCredential: (user: unknown, credential: unknown) =>
    linkWithCredentialMock(user, credential),
  signInWithCustomToken: (auth: unknown, token: string) =>
    signInWithCustomTokenMock(auth, token),
  signInWithEmailAndPassword: (
    auth: unknown,
    email: string,
    password: string,
  ) => signInWithEmailAndPasswordMock(auth, email, password),
  signInWithPopup: (auth: unknown, provider: unknown) =>
    signInWithPopupMock(auth, provider),
  signOut: (auth?: unknown) => signOutMock(auth),
  createUserWithEmailAndPassword: jest.fn(() => Promise.resolve({ user: {} })),
  updateProfile: (user: unknown, profile: unknown) =>
    updateProfileMock(user, profile),
}));

jest.mock("firebase/database", () => ({
  ref: (db: unknown, path: string) => refMock(db, path),
  onValue: (
    target: { path: string },
    callback: (snapshot: unknown) => void,
    onError?: (error: unknown) => void,
  ) => onValueMock(target, callback, onError),
  set: (target: unknown, value: unknown) => setMock(target, value),
  onDisconnect: jest.fn(() => ({
    remove: jest.fn(),
    cancel: jest.fn(() => Promise.resolve()),
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

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const ContextProbe = () => {
  const context = useContext(GlobalInfoContext);
  const location = useLocation();

  if (!context) return null;

  return (
    <div>
      <div data-testid="session-kind">{context.sessionKind || "none"}</div>
      <div data-testid="church-id">{context.churchId || "none"}</div>
      <div data-testid="operator-name">{context.operatorName || "none"}</div>
      <div data-testid="auth-status">{context.authServerStatus}</div>
      <div data-testid="user-name">{context.user || "none"}</div>
      <div data-testid="branding-status">{context.churchBrandingStatus}</div>
      <div data-testid="branding-mission">
        {context.churchBranding.mission || "none"}
      </div>
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

const AuthActionsProbe = () => {
  const context = useContext(GlobalInfoContext);

  if (!context) return null;

  return (
    <div>
      <div data-testid="probe-auth-status">{context.authServerStatus}</div>
      <div data-testid="probe-auth-error">{context.authError || "none"}</div>
      <div data-testid="pending-email-verification-id">
        {context.pendingEmailVerificationId || "none"}
      </div>
      <div data-testid="pending-link-provider">
        {context.pendingLinkState?.providerId || "none"}
      </div>
      <button
        type="button"
        onClick={() =>
          void context.login({
            method: "google",
          })
        }
      >
        Google sign in
      </button>
      <button
        type="button"
        onClick={() =>
          void context.login({
            method: "password",
            email: "person@example.com",
            password: "Secret-pass1!",
          })
        }
      >
        Password sign in
      </button>
      <button
        type="button"
        onClick={() =>
          void context.createChurchAccount({
            method: "google",
            churchName: "Test Church",
            adminName: "Leader Name",
          })
        }
      >
        Create church with Google
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
    onValueErrorCallbacks.clear();
    refMock.mockClear();
    onValueMock.mockClear();
    setMock.mockClear();
    signInWithCustomTokenMock.mockClear();
    signOutMock.mockClear();
    signInWithEmailAndPasswordMock.mockReset();
    signInWithPopupMock.mockReset();
    fetchSignInMethodsForEmailMock.mockReset();
    linkWithCredentialMock.mockReset();
    updateProfileMock.mockReset();
    googleCredentialFromErrorMock.mockReset();
    googleCredentialFactoryMock.mockClear();
    microsoftCredentialFromErrorMock.mockReset();
    mockHumanAuth.currentUser = null;
    (authApi.getAuthBootstrap as jest.Mock).mockReset();
    (authApi.getSharedDataToken as jest.Mock).mockReset();
    (authApi.unlinkWorkstation as jest.Mock).mockReset();
    (authApi.updateWorkstationOperator as jest.Mock).mockReset();
    (authApi.createHumanSession as jest.Mock).mockReset();
    (authApi.createChurchAccount as jest.Mock).mockReset();
    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(demoBootstrap);
    (authApi.getSharedDataToken as jest.Mock).mockResolvedValue({
      success: true,
      token: "test-token",
      database: "main",
    });
    (authApi.unlinkWorkstation as jest.Mock).mockResolvedValue({
      success: true,
    });
    (authApi.updateWorkstationOperator as jest.Mock).mockResolvedValue({
      success: true,
      workstation: {},
    });
    signInWithEmailAndPasswordMock.mockResolvedValue({ user: mockHumanAuth.currentUser });
    signInWithPopupMock.mockResolvedValue({ user: mockHumanAuth.currentUser });
    fetchSignInMethodsForEmailMock.mockResolvedValue([]);
    linkWithCredentialMock.mockResolvedValue({ success: true });
    (authApi.createHumanSession as jest.Mock).mockResolvedValue({
      success: true,
      bootstrap: loggedInHumanBootstrap,
    });
    (authApi.createChurchAccount as jest.Mock).mockResolvedValue({
      success: true,
      requiresEmailCode: true,
      pendingAuthId: "pending-123",
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

  it("subscribes to church branding and exposes live branding updates", async () => {
    localStorage.setItem("loggedIn", "true");
    localStorage.setItem("user", "Test User");
    localStorage.setItem("database", "main");

    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(loggedInHumanBootstrap);

    renderProvider(<ContextProbe />);

    await waitFor(() =>
      expect(
        onValueCallbacks.has("churches/church-1/data/branding"),
      ).toBe(true),
    );

    act(() => {
      onValueCallbacks.get("churches/church-1/data/branding")?.(
        snapshotFor({
          mission: "Serve faithfully.",
          vision: "Lead clearly.",
          colors: [{ label: "Primary", value: "#112233" }],
          logos: {
            square: {
              url: "https://res.cloudinary.com/portable-media/image/upload/v1/logo.png",
              publicId: "branding/logo-square",
            },
          },
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId("branding-status")).toHaveTextContent("ready"),
    );
    expect(screen.getByTestId("branding-mission")).toHaveTextContent(
      "Serve faithfully.",
    );
  });

  it("falls back to ready empty branding when the branding listener errors", async () => {
    localStorage.setItem("loggedIn", "true");
    localStorage.setItem("user", "Test User");
    localStorage.setItem("database", "main");

    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(loggedInHumanBootstrap);

    renderProvider(<ContextProbe />);

    await waitFor(() =>
      expect(
        onValueErrorCallbacks.has("churches/church-1/data/branding"),
      ).toBe(true),
    );

    act(() => {
      onValueErrorCallbacks
        .get("churches/church-1/data/branding")
        ?.(
          new Error("permission-denied"),
        );
    });

    await waitFor(() =>
      expect(screen.getByTestId("branding-status")).toHaveTextContent("ready"),
    );
    expect(screen.getByTestId("branding-mission")).toHaveTextContent("none");
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

  it("re-authenticates shared Firebase when the session context changes mid-session", async () => {
    const staleSharedToken = createDeferred<{
      success: true;
      token: string;
      database: string;
    }>();
    const freshSharedToken = createDeferred<{
      success: true;
      token: string;
      database: string;
    }>();

    (authApi.getAuthBootstrap as jest.Mock)
      .mockResolvedValueOnce(loggedInWorkstationBootstrap)
      .mockResolvedValueOnce({
        ...loggedInWorkstationBootstrap,
        churchId: "church-2",
        churchName: "Second Church",
        database: "main-2",
        device: {
          ...loggedInWorkstationBootstrap.device,
          deviceId: "workstation-2",
          label: "Balcony Laptop",
        },
      });
    (authApi.getSharedDataToken as jest.Mock)
      .mockReturnValueOnce(staleSharedToken.promise)
      .mockReturnValueOnce(freshSharedToken.promise);

    renderProvider(<ContextProbe />);

    await waitFor(() =>
      expect(authApi.getSharedDataToken).toHaveBeenCalledTimes(1)
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh bootstrap" }));

    await waitFor(() =>
      expect(screen.getByTestId("church-id")).toHaveTextContent("church-2")
    );
    await waitFor(() =>
      expect(authApi.getSharedDataToken).toHaveBeenCalledTimes(2)
    );
    expect(onValueCallbacks.has("churches/church-2/data/branding")).toBe(false);
    expect(onValueCallbacks.has("churches/church-2/data/activeInstances")).toBe(
      false
    );
    expect(
      onValueCallbacks.has("churches/church-2/data/presentation/projectorInfo")
    ).toBe(false);

    staleSharedToken.resolve({
      success: true,
      token: "stale-token",
      database: "main",
    });

    await waitFor(() =>
      expect(signInWithCustomTokenMock).toHaveBeenCalledTimes(0)
    );
    expect(onValueCallbacks.has("churches/church-2/data/branding")).toBe(false);
    expect(onValueCallbacks.has("churches/church-2/data/activeInstances")).toBe(
      false
    );

    freshSharedToken.resolve({
      success: true,
      token: "fresh-token",
      database: "main-2",
    });

    await waitFor(() =>
      expect(signInWithCustomTokenMock).toHaveBeenCalledTimes(1)
    );
    expect(signInWithCustomTokenMock).toHaveBeenLastCalledWith(
      expect.anything(),
      "fresh-token"
    );
    await waitFor(() =>
      expect(onValueCallbacks.has("churches/church-2/data/branding")).toBe(true)
    );
    expect(onValueCallbacks.has("churches/church-2/data/activeInstances")).toBe(
      true
    );
    expect(
      onValueCallbacks.has("churches/church-2/data/presentation/projectorInfo")
    ).toBe(true);
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

describe("GlobalInfoProvider auth regression coverage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    setPendingLinkState(null);
    setPendingLinkCredentialState(null);
    mockHumanAuth.currentUser = null;
    (authApi.getAuthBootstrap as jest.Mock).mockReset();
    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(demoBootstrap);
    (authApi.createHumanSession as jest.Mock).mockReset();
    (authApi.createHumanSession as jest.Mock).mockResolvedValue({
      success: true,
      bootstrap: loggedInHumanBootstrap,
    });
    (authApi.createChurchAccount as jest.Mock).mockReset();
    (authApi.createChurchAccount as jest.Mock).mockResolvedValue({
      success: true,
      requiresEmailCode: true,
      pendingAuthId: "pending-123",
    });
    signInWithEmailAndPasswordMock.mockReset();
    signInWithEmailAndPasswordMock.mockResolvedValue({
      user: mockHumanAuth.currentUser,
    });
    signInWithPopupMock.mockReset();
    signInWithPopupMock.mockResolvedValue({ user: mockHumanAuth.currentUser });
    fetchSignInMethodsForEmailMock.mockReset();
    fetchSignInMethodsForEmailMock.mockResolvedValue([]);
    linkWithCredentialMock.mockReset();
    linkWithCredentialMock.mockResolvedValue({ success: true });
    googleCredentialFromErrorMock.mockReset();
    microsoftCredentialFromErrorMock.mockReset();
    googleCredentialFactoryMock.mockClear();
  });

  it("clears stale pending-link UI state when no linkable credential remains", async () => {
    setPendingLinkState({
      email: "person@example.com",
      providerId: "google.com",
      requiredMethods: ["password"],
    });

    renderProvider(<AuthActionsProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("pending-link-provider")).toHaveTextContent("none");
    });
    expect(getPendingLinkState()).toBeNull();
    expect(getPendingLinkCredentialState()).toBeNull();
  });

  it("restores a pending provider link after remount and links on password sign-in", async () => {
    const collisionError = Object.assign(new Error("collision"), {
      code: "auth/account-exists-with-different-credential",
      customData: { email: "person@example.com" },
    });
    googleCredentialFromErrorMock.mockReturnValue({
      toJSON: () => ({
        oauthAccessToken: "google-token",
      }),
    });
    signInWithPopupMock.mockRejectedValueOnce(collisionError);
    fetchSignInMethodsForEmailMock.mockResolvedValue(["password"]);

    const linkedUser = {
      uid: "user-1",
      getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
    };
    signInWithEmailAndPasswordMock.mockResolvedValue({ user: linkedUser });

    const view = renderProvider(<AuthActionsProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("probe-auth-status")).toHaveTextContent("online");
    });

    fireEvent.click(screen.getByRole("button", { name: "Google sign in" }));

    await waitFor(() => {
      expect(getPendingLinkState()?.providerId).toBe("google.com");
    });
    expect(getPendingLinkCredentialState()).toEqual({
      providerId: "google.com",
      credentialJson: {
        oauthAccessToken: "google-token",
      },
    });

    view.unmount();

    renderProvider(<AuthActionsProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("probe-auth-status")).toHaveTextContent("online");
    });
    await waitFor(() => {
      expect(screen.getByTestId("pending-link-provider")).toHaveTextContent(
        "google.com",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Password sign in" }));

    await waitFor(() => {
      expect(linkWithCredentialMock).toHaveBeenCalledWith(
        linkedUser,
        expect.objectContaining({
          providerId: "google.com",
        }),
      );
    });
    expect(getPendingLinkState()).toBeNull();
    expect(getPendingLinkCredentialState()).toBeNull();
  });

  it("continues password sign-in when a restored provider link can no longer be applied", async () => {
    setPendingLinkState({
      email: "person@example.com",
      providerId: "google.com",
      requiredMethods: ["password"],
    });
    setPendingLinkCredentialState({
      providerId: "google.com",
      credentialJson: {
        oauthAccessToken: "expired-token",
      },
    });

    const linkedUser = {
      uid: "user-2",
      getIdToken: jest.fn(() => Promise.resolve("firebase-id-token")),
    };
    signInWithEmailAndPasswordMock.mockResolvedValue({ user: linkedUser });
    linkWithCredentialMock.mockRejectedValueOnce(new Error("credential-expired"));

    renderProvider(<AuthActionsProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("pending-link-provider")).toHaveTextContent(
        "google.com",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Password sign in" }));

    await waitFor(() => {
      expect(authApi.createHumanSession).toHaveBeenCalledWith(
        expect.objectContaining({
          idToken: "firebase-id-token",
        }),
      );
    });
    expect(getPendingLinkState()).toBeNull();
    expect(getPendingLinkCredentialState()).toBeNull();
  });

  it("shows an SSO guidance message when password auth fails", async () => {
    signInWithEmailAndPasswordMock.mockRejectedValueOnce(
      Object.assign(new Error("invalid"), {
        code: "auth/invalid-credential",
      }),
    );

    renderProvider(<AuthActionsProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("probe-auth-status")).toHaveTextContent("online");
    });

    fireEvent.click(screen.getByRole("button", { name: "Password sign in" }));

    await waitFor(() => {
      expect(screen.getByTestId("probe-auth-error")).toHaveTextContent(
        "Could not sign in with email and password. If this account uses Google or Microsoft, continue with that method instead.",
      );
    });
    expect(authApi.createHumanSession).not.toHaveBeenCalled();
  });

  it("stores the pending verification id when provider login requires an email code", async () => {
    const providerUser = {
      uid: "provider-user",
      getIdToken: jest.fn(() => Promise.resolve("provider-id-token")),
    };
    mockHumanAuth.currentUser = providerUser;
    signInWithPopupMock.mockResolvedValue({ user: providerUser });
    (authApi.createHumanSession as jest.Mock).mockResolvedValue({
      success: true,
      requiresEmailCode: true,
      pendingAuthId: "pending-provider-code",
    });

    renderProvider(<AuthActionsProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("probe-auth-status")).toHaveTextContent("online");
    });

    fireEvent.click(screen.getByRole("button", { name: "Google sign in" }));

    await waitFor(() => {
      expect(screen.getByTestId("pending-email-verification-id")).toHaveTextContent(
        "pending-provider-code",
      );
    });
  });

  it("does not delete or rename a provider user when church creation fails", async () => {
    const providerUser = {
      uid: "provider-user",
      delete: jest.fn(() => Promise.resolve()),
      getIdToken: jest.fn(() => Promise.resolve("provider-id-token")),
    };
    mockHumanAuth.currentUser = providerUser;
    signInWithPopupMock.mockResolvedValue({ user: providerUser });
    (authApi.createChurchAccount as jest.Mock).mockRejectedValue(
      new Error("This account already belongs to a church."),
    );

    renderProvider(<AuthActionsProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("probe-auth-status")).toHaveTextContent("online");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Create church with Google" }),
    );

    await waitFor(() => {
      expect(authApi.createChurchAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          idToken: "provider-id-token",
          adminName: "Leader Name",
        }),
      );
    });
    expect(providerUser.delete).not.toHaveBeenCalled();
    expect(updateProfileMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledWith(mockHumanAuth);
    });
  });
});
