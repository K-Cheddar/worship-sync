import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useContext } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import GlobalInfoProvider, {
  GlobalInfoContext,
  globalFireDbInfo,
} from "./globalInfo";
import * as authApi from "../api/auth";
import { requestAuthRecovery } from "../api/authErrorBus";
import * as firebaseApps from "../firebase/apps";
import * as environmentUtils from "../utils/environment";
import {
  getPendingDesktopEmailResendState,
  getPendingProviderRedirectState,
  getPendingLinkCredentialState,
  getPendingLinkState,
  setPendingDesktopEmailResendState,
  setPendingProviderRedirectState,
  setPendingLinkCredentialState,
  setPendingLinkState,
  getWorkstationSessionOperatorName,
  setWorkstationSessionOperatorName,
} from "../utils/authStorage";

const mockDispatch = jest.fn();
const onValueCallbacks = new Map<string, (snapshot: any) => void>();
const onValueErrorCallbacks = new Map<string, (error: unknown) => void>();
const onValueCallbackHistory = new Map<string, Array<(snapshot: any) => void>>();

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
    const callbacks = onValueCallbackHistory.get(target.path) || [];
    callbacks.push(callback);
    onValueCallbackHistory.set(target.path, callbacks);
    if (onError) {
      onValueErrorCallbacks.set(target.path, onError);
    }
    return jest.fn();
  }
);
const setMock = jest.fn();
const getDatabaseMock = jest.fn(() => ({
  name: "firebase-db",
  app: { options: { databaseURL: "https://test.firebaseio.com" } },
}));
const mockSharedDataUser = {
  getIdToken: jest.fn(() => Promise.resolve("test-id-token")),
};
const mockSharedDataAuth = { currentUser: mockSharedDataUser };
const signInWithCustomTokenMock = jest.fn<any, any[]>(() => Promise.resolve({}));
const signOutMock = jest.fn<any, any[]>(() => Promise.resolve());
const signInWithEmailAndPasswordMock = jest.fn<any, any[]>(() => Promise.resolve({}));
const signInWithPopupMock = jest.fn<any, any[]>(() => Promise.resolve({}));
const getRedirectResultMock = jest.fn<any, any[]>(() => Promise.resolve(null));
const signInWithRedirectMock = jest.fn<any, any[]>(() => Promise.resolve());
const fetchSignInMethodsForEmailMock = jest.fn<any, any[]>(() => Promise.resolve([]));
const linkWithCredentialMock = jest.fn<any, any[]>(() => Promise.resolve({}));
const updateProfileMock = jest.fn<any, any[]>(() => Promise.resolve());
const reloadMock = jest.fn<any, any[]>(() => Promise.resolve());
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
  exchangeDesktopAuth: jest.fn(),
  forgotPassword: jest.fn(),
  logoutSession: jest.fn(),
  resendEmailCode: jest.fn(),
  unlinkWorkstation: jest.fn(() => Promise.resolve({ success: true })),
  verifyEmailCode: jest.fn(),
  updateWorkstationOperator: jest.fn(() =>
    Promise.resolve({ success: true, workstation: {} })
  ),
}));

jest.mock("../firebase/apps", () => ({
  getHumanAuth: jest.fn(() => mockHumanAuth),
  getSharedDataAuth: jest.fn(() => mockSharedDataAuth),
  getSharedDataDatabase: jest.fn(() => ({ name: "firebase-db" })),
}));

jest.mock("../utils/environment", () => ({
  ...jest.requireActual("../utils/environment"),
  isElectron: jest.fn(() => false),
  isPackagedElectronRenderer: jest.fn(() => false),
  reloadElectronDisplayWindows: jest.fn(),
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
  getRedirectResult: (auth: unknown) => getRedirectResultMock(auth),
  signInWithRedirect: (auth: unknown, provider: unknown) =>
    signInWithRedirectMock(auth, provider),
  signOut: (auth?: unknown) => signOutMock(auth),
  reload: (user: unknown) => reloadMock(user),
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

const loggedInDisplayBootstrap = {
  ...loggedInWorkstationBootstrap,
  sessionKind: "display" as const,
  appAccess: "view" as const,
  device: {
    deviceId: "display-1",
    label: "Projector",
    operatorName: null,
    surfaceType: "projector" as const,
  },
  csrfToken: null,
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
      <div data-testid="realtime-connected">
        {context.realtimeConnected ? "yes" : "no"}
      </div>
      <div data-testid="content-hidden-snapshots">
        {JSON.stringify(context.contentHiddenByOutput)}
      </div>
      <div data-testid="church-id">{context.churchId || "none"}</div>
      <div data-testid="operator-name">{context.operatorName || "none"}</div>
      <div data-testid="auth-status">{context.authServerStatus}</div>
      <div data-testid="user-name">{context.user || "none"}</div>
      <div data-testid="branding-status">{context.churchBrandingStatus}</div>
      <div data-testid="branding-mission">
        {context.churchBranding.mission || "none"}
      </div>
      <div data-testid="integrations-status">
        {context.churchIntegrationsStatus}
      </div>
      <div data-testid="workspace-status">
        {context.currentServiceWorkspaceStatus}
      </div>
      <div data-testid="workspace-displays">
        {context.currentServiceWorkspace.sections.displays ? "yes" : "no"}
      </div>
      <div data-testid="youtube-connected">
        {context.churchIntegrations.youtube.connected ? "yes" : "no"}
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
  const location = useLocation();

  if (!context) return null;

  return (
    <div>
      <div data-testid="path">{location.pathname}</div>
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
            method: "microsoft",
          })
        }
      >
        Microsoft sign in
      </button>
      <button
        type="button"
        onClick={() =>
          void context.login({
            method: "google",
            interaction: "redirect",
            redirectOnly: true,
          })
        }
      >
        Complete redirect sign in
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

const CodeActionsProbe = () => {
  const context = useContext(GlobalInfoContext);
  if (!context) return null;
  return (
    <button
      type="button"
      onClick={() =>
        void context.resendEmailCode({
          pendingAuthId: "pending-auth-code",
        })
      }
    >
      Resend code
    </button>
  );
};

describe("GlobalInfoProvider presentation listener contracts", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockDispatch.mockClear();
    onValueCallbacks.clear();
    onValueErrorCallbacks.clear();
    onValueCallbackHistory.clear();
    refMock.mockClear();
    onValueMock.mockClear();
    setMock.mockClear();
    signInWithCustomTokenMock.mockClear();
    signOutMock.mockClear();
    signInWithEmailAndPasswordMock.mockReset();
    signInWithPopupMock.mockReset();
    getRedirectResultMock.mockReset();
    signInWithRedirectMock.mockReset();
    getRedirectResultMock.mockResolvedValue(null);
    signInWithRedirectMock.mockResolvedValue(undefined);
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
    (authApi.exchangeDesktopAuth as jest.Mock).mockReset();
    (authApi.resendEmailCode as jest.Mock).mockReset();
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
    (authApi.resendEmailCode as jest.Mock).mockResolvedValue({
      success: true,
      requiresEmailCode: true,
      pendingAuthId: "pending-auth-code-next",
    });
    (environmentUtils.isElectron as jest.Mock).mockReturnValue(false);
    (environmentUtils.isPackagedElectronRenderer as jest.Mock).mockReturnValue(
      false,
    );
    setPendingDesktopEmailResendState(null);
    (firebaseApps.getSharedDataDatabase as jest.Mock).mockImplementation(() =>
      getDatabaseMock()
    );
    (firebaseApps.getSharedDataDatabase as jest.Mock).mockClear();
    mockSharedDataUser.getIdToken.mockClear();
    mockSharedDataUser.getIdToken.mockResolvedValue("test-id-token");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(false),
    }) as jest.Mock;
  });

  it("does not sign shared-data auth out while initial bootstrap is loading", async () => {
    let resolveBootstrap: ((value: typeof demoBootstrap) => void) | undefined;
    (authApi.getAuthBootstrap as jest.Mock).mockImplementation(
      () =>
        new Promise<typeof demoBootstrap>((resolve) => {
          resolveBootstrap = resolve;
        }),
    );

    renderProvider();

    await waitFor(() => expect(authApi.getAuthBootstrap).toHaveBeenCalled());
    expect(signOutMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveBootstrap?.(demoBootstrap);
    });

    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));
  });

  it("marks display sessions as read-only for shared realtime data", async () => {
    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(
      loggedInDisplayBootstrap,
    );

    renderProvider();

    await waitFor(() =>
      expect(firebaseApps.getSharedDataDatabase).toHaveBeenCalled(),
    );
    expect(globalFireDbInfo.canWriteSharedData).toBe(false);
    expect(
      onValueCallbacks.has("churches/church-1/data/currentServiceWorkspace"),
    ).toBe(false);
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

  it("cold-hydrates presentation keys from localStorage when the storage listener attaches", async () => {
    const projectorInfo = { name: "Live Projector", time: 501 };
    const monitorInfo = { name: "Live Monitor", time: 502 };
    const streamInfo = { name: "Live Stream", time: 503 };
    const outputs = {
      out_lobby: {
        id: "out_lobby",
        type: "projector",
        info: { name: "Lobby", time: 504 },
      },
    };

    localStorage.setItem("projectorInfo", JSON.stringify(projectorInfo));
    localStorage.setItem("monitorInfo", JSON.stringify(monitorInfo));
    localStorage.setItem("streamInfo", JSON.stringify(streamInfo));
    localStorage.setItem("outputs", JSON.stringify(outputs));
    localStorage.setItem("stream_itemContentBlocked", JSON.stringify(false));
    localStorage.setItem("not_a_screen_key", JSON.stringify({ ignored: true }));

    renderProvider();

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
              type: "debouncedUpdateOutputs",
              payload: outputs,
            },
          ],
          [
            {
              type: "debouncedUpdateStreamItemContentBlocked",
              payload: false,
            },
          ],
        ]),
      ),
    );
    expect(mockDispatch).toHaveBeenCalledTimes(5);
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
    expect(onValueCallbacks.has("churches/church-1/data/services")).toBe(true);

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
    onValueCallbacks
      .get("churches/church-1/data/services")
      ?.(snapshotFor([{ id: "service-1", name: "Remote Service" }]));

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
          [
            {
              type: "debouncedUpdateServiceTimes",
              payload: [{ id: "service-1", name: "Remote Service" }],
            },
          ],
        ])
      )
    );

    mockDispatch.mockClear();
    onValueCallbacks
      .get("churches/church-1/data/services")
      ?.(snapshotFor(null));

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "debouncedUpdateServiceTimes",
        payload: [],
      })
    );

    mockDispatch.mockClear();
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "serviceTimes",
          newValue: JSON.stringify([{ id: "local-only" }]),
        }),
      );
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("reattaches presentation listeners after the realtime database reconnects", async () => {
    localStorage.setItem("loggedIn", "true");
    localStorage.setItem("user", "Test User");
    localStorage.setItem("database", "main");

    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(loggedInHumanBootstrap);

    renderProvider(<ContextProbe />);

    const streamInfoPath = "churches/church-1/data/presentation/streamInfo";

    await waitFor(() =>
      expect(onValueCallbacks.has(streamInfoPath)).toBe(true)
    );
    await waitFor(() =>
      expect(onValueCallbacks.has(".info/connected")).toBe(true)
    );

    const countStreamInfoSubscriptions = () =>
      onValueMock.mock.calls.filter(([target]) => target.path === streamInfoPath)
        .length;
    const initialSubscriptionCount = countStreamInfoSubscriptions();

    act(() => {
      onValueCallbacks.get(".info/connected")?.(snapshotFor(true));
    });
    expect(screen.getByTestId("realtime-connected")).toHaveTextContent("yes");

    await waitFor(() =>
      expect(countStreamInfoSubscriptions()).toBeGreaterThan(
        initialSubscriptionCount,
      ),
    );

    act(() => {
      onValueCallbacks.get(".info/connected")?.(snapshotFor(false));
    });
    expect(screen.getByTestId("realtime-connected")).toHaveTextContent("no");
    act(() => {
      onValueCallbacks.get(".info/connected")?.(snapshotFor(true));
    });
    expect(screen.getByTestId("realtime-connected")).toHaveTextContent("yes");

    await waitFor(() =>
      expect(countStreamInfoSubscriptions()).toBeGreaterThan(
        initialSubscriptionCount,
      )
    );
  });

  it("retains only Firebase-confirmed stream states across listener reconnection", async () => {
    localStorage.setItem("loggedIn", "true");
    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(loggedInHumanBootstrap);
    renderProvider(<ContextProbe />);

    const blockedPath = "churches/church-1/data/presentation/stream_itemContentBlocked";
    const outputsPath = "churches/church-1/data/presentation/outputs";
    await waitFor(() => expect(onValueCallbacks.has(blockedPath)).toBe(true));
    expect(onValueCallbacks.has(outputsPath)).toBe(true);
    expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent("{}");

    act(() => {
      onValueCallbacks.get(blockedPath)?.(snapshotFor(true));
      onValueCallbacks.get(outputsPath)?.(
        snapshotFor({
          "out-lobby": { type: "stream", itemContentBlocked: true },
          "out-projector": { type: "projector", itemContentBlocked: true },
        }),
      );
    });
    expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
      '"stream":{"hidden":true,"confirmed":false}',
    );
    expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
      '"out-lobby":{"hidden":true,"confirmed":false}',
    );
    expect(screen.getByTestId("content-hidden-snapshots")).not.toHaveTextContent(
      "out-projector",
    );

    const outputsSubscriptionCount = () =>
      onValueMock.mock.calls.filter(([target]) => target.path === outputsPath).length;
    act(() => {
      onValueCallbacks.get(".info/connected")?.(snapshotFor(true));
    });
    act(() => {
      onValueCallbacks.get(".info/connected")?.(snapshotFor(false));
    });
    expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
      '"out-lobby":{"hidden":true,"confirmed":false}',
    );

    const oldSubscriptionCount = outputsSubscriptionCount();
    act(() => {
      onValueCallbacks.get(".info/connected")?.(snapshotFor(true));
    });
    await waitFor(() =>
      expect(outputsSubscriptionCount()).toBeGreaterThan(oldSubscriptionCount),
    );
    expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
      '"out-lobby":{"hidden":true,"confirmed":false}',
    );

    (global.fetch as jest.Mock).mockImplementation(async (input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve(false),
    }));
    act(() => {
      onValueCallbacks.get(blockedPath)?.(snapshotFor(false));
      onValueCallbacks.get(outputsPath)?.(
        snapshotFor({ "out-lobby": { type: "stream", itemContentBlocked: false } }),
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
        '"out-lobby":{"hidden":false,"confirmed":true}',
      ),
    );
    act(() => {
      onValueCallbacks.get(".info/connected")?.(snapshotFor(false));
    });
    expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
      '"out-lobby":{"hidden":false,"confirmed":false}',
    );
  });

  it("reconciles cached stream snapshots independently against fresh server values", async () => {
    localStorage.setItem("loggedIn", "true");
    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(loggedInHumanBootstrap);
    renderProvider(<ContextProbe />);

    const outputsPath = "churches/church-1/data/presentation/outputs";
    await waitFor(() => expect(onValueCallbacks.has(outputsPath)).toBe(true));
    act(() => onValueCallbacks.get(".info/connected")?.(snapshotFor(true)));
    await waitFor(() =>
      expect((onValueCallbackHistory.get(outputsPath) || []).length).toBeGreaterThan(1),
    );

    const firstRead = createDeferred<Response>();
    const secondRead = createDeferred<Response>();
    const responseByOutput: Record<string, boolean> = {
      "out-lobby": false,
      "out-youth": true,
    };
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("out-lobby")) return firstRead.promise;
      if (url.includes("out-youth")) return secondRead.promise;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseByOutput["out-lobby"]),
      });
    });

    act(() =>
      onValueCallbacks.get(outputsPath)?.(
        snapshotFor({
          "out-lobby": { type: "stream", itemContentBlocked: true },
          "out-youth": { type: "stream", itemContentBlocked: true },
        }),
      ),
    );
    expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
      '"out-lobby":{"hidden":true,"confirmed":false}',
    );
    expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
      '"out-youth":{"hidden":true,"confirmed":false}',
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const requestedPaths = (global.fetch as jest.Mock).mock.calls.map(([input]) =>
      new URL(String(input)),
    );
    expect(requestedPaths.map((url) => url.pathname)).toEqual(
      expect.arrayContaining([
        "/churches/church-1/data/presentation/outputs/out-lobby/itemContentBlocked.json",
        "/churches/church-1/data/presentation/outputs/out-youth/itemContentBlocked.json",
      ]),
    );
    requestedPaths.forEach((url) =>
      expect(url.searchParams.get("auth")).toBe("test-id-token"),
    );
    await act(async () => {
      firstRead.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseByOutput["out-lobby"]),
      } as Response);
      await firstRead.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
        '"out-lobby":{"hidden":false,"confirmed":true}',
      ),
    );
    await act(async () => {
      secondRead.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(responseByOutput["out-youth"]),
      } as Response);
      await secondRead.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
        '"out-youth":{"hidden":true,"confirmed":true}',
      ),
    );

    responseByOutput["out-lobby"] = true;
    act(() =>
      onValueCallbacks.get(outputsPath)?.(
        snapshotFor({
          "out-lobby": { type: "stream", itemContentBlocked: false },
          "out-youth": { type: "stream", itemContentBlocked: true },
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
        '"out-lobby":{"hidden":true,"confirmed":true}',
      ),
    );
    act(() => onValueCallbacks.get(".info/connected")?.(snapshotFor(false)));
    expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
      '"out-youth":{"hidden":true,"confirmed":false}',
    );
  });

  it("keeps failed authoritative reads unconfirmed and ignores obsolete callbacks", async () => {
    localStorage.setItem("loggedIn", "true");
    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(loggedInHumanBootstrap);
    renderProvider(<ContextProbe />);

    const outputsPath = "churches/church-1/data/presentation/outputs";
    await waitFor(() => expect(onValueCallbacks.has(outputsPath)).toBe(true));
    const originalOutputsCallback = onValueCallbacks.get(outputsPath);
    act(() => onValueCallbacks.get(".info/connected")?.(snapshotFor(true)));
    await waitFor(() =>
      expect((onValueCallbackHistory.get(outputsPath) || []).length).toBeGreaterThan(1),
    );

    (global.fetch as jest.Mock).mockRejectedValue(new Error("server unavailable"));
    act(() =>
      onValueCallbacks.get(outputsPath)?.(
        snapshotFor({ "out-lobby": { type: "stream", itemContentBlocked: true } }),
      ),
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
      '"out-lobby":{"hidden":true,"confirmed":false}',
    );

    act(() => onValueCallbacks.get(".info/connected")?.(snapshotFor(false)));
    expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
      '"out-lobby":{"hidden":true,"confirmed":false}',
    );
    act(() => onValueCallbacks.get(".info/connected")?.(snapshotFor(true)));
    await waitFor(() =>
      expect((onValueCallbackHistory.get(outputsPath) || []).length).toBeGreaterThan(2),
    );

    const newOutputsCallback = onValueCallbacks.get(outputsPath);
    act(() => {
      originalOutputsCallback?.(
        snapshotFor({ "out-lobby": { type: "stream", itemContentBlocked: false } }),
      );
      newOutputsCallback?.(
        snapshotFor({ "out-lobby": { type: "stream", itemContentBlocked: true } }),
      );
    });
    expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
      '"out-lobby":{"hidden":true,"confirmed":false}',
    );
  });

  it("clears retained hidden status when church or authenticated user scope changes", async () => {
    localStorage.setItem("loggedIn", "true");
    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(loggedInHumanBootstrap);
    renderProvider(<ContextProbe />);

    const outputsPath = "churches/church-1/data/presentation/outputs";
    await waitFor(() => expect(onValueCallbacks.has(outputsPath)).toBe(true));
    act(() => onValueCallbacks.get(".info/connected")?.(snapshotFor(true)));
    await waitFor(() =>
      expect((onValueCallbackHistory.get(outputsPath) || []).length).toBeGreaterThan(1),
    );
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(true),
    });
    act(() =>
      onValueCallbacks.get(outputsPath)?.(
        snapshotFor({ "out-lobby": { type: "stream", itemContentBlocked: true } }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
        '"out-lobby":{"hidden":true,"confirmed":true}',
      ),
    );

    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue({
      ...loggedInHumanBootstrap,
      churchId: "church-2",
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh bootstrap" }));
    await waitFor(() => expect(screen.getByTestId("church-id")).toHaveTextContent("church-2"));
    await waitFor(() =>
      expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent("{}"),
    );
    await waitFor(() =>
      expect(onValueCallbacks.has("churches/church-2/data/presentation/outputs")).toBe(true),
    );
    act(() => onValueCallbacks.get(".info/connected")?.(snapshotFor(true)));
    await waitFor(() =>
      expect((onValueCallbackHistory.get("churches/church-2/data/presentation/outputs") || []).length)
        .toBeGreaterThan(1),
    );
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(true),
    });
    act(() =>
      onValueCallbacks.get("churches/church-2/data/presentation/outputs")?.(
        snapshotFor({ "out-lobby": { type: "stream", itemContentBlocked: true } }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent(
        '"out-lobby":{"hidden":true,"confirmed":true}',
      ),
    );

    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue({
      ...loggedInHumanBootstrap,
      churchId: "church-2",
      user: { ...loggedInHumanBootstrap.user, uid: "u2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh bootstrap" }));
    await waitFor(() =>
      expect((onValueCallbackHistory.get("churches/church-2/data/presentation/outputs") || []).length)
        .toBeGreaterThan(1),
    );
    await waitFor(() =>
      expect(screen.getByTestId("content-hidden-snapshots")).toHaveTextContent("{}"),
    );
    act(() =>
      onValueCallbackHistory.get(outputsPath)?.[0]?.(
        snapshotFor({ "out-lobby": { type: "stream", itemContentBlocked: true } }),
      ),
    );
    expect(screen.getByTestId("content-hidden-snapshots")).not.toHaveTextContent("out-lobby");
  });

  it("retries presentation listeners on permission_denied without reminting shared realtime auth", async () => {
    localStorage.setItem("loggedIn", "true");
    localStorage.setItem("user", "Test User");
    localStorage.setItem("database", "main");

    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(loggedInHumanBootstrap);

    renderProvider();

    const streamInfoPath = "churches/church-1/data/presentation/streamInfo";

    await waitFor(() =>
      expect(onValueErrorCallbacks.has(streamInfoPath)).toBe(true)
    );
    await waitFor(() =>
      expect(authApi.getSharedDataToken).toHaveBeenCalledTimes(1)
    );

    const countStreamInfoSubscriptions = () =>
      onValueMock.mock.calls.filter(([target]) => target.path === streamInfoPath)
        .length;
    const before = countStreamInfoSubscriptions();

    // A permission_denied cancellation must re-attach (recover from the startup
    // auth race) — but unlike branding it must NOT remint the shared-data token.
    act(() => {
      onValueErrorCallbacks.get(streamInfoPath)?.(new Error("permission_denied"));
    });

    await waitFor(() =>
      expect(countStreamInfoSubscriptions()).toBeGreaterThan(before)
    );
    expect(authApi.getSharedDataToken).toHaveBeenCalledTimes(1);
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

  it("subscribes to current service workspace settings and normalizes partial data", async () => {
    localStorage.setItem("loggedIn", "true");
    localStorage.setItem("user", "Test User");
    localStorage.setItem("database", "main");

    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(loggedInHumanBootstrap);

    renderProvider(<ContextProbe />);

    const workspacePath = "churches/church-1/data/currentServiceWorkspace";
    await waitFor(() => expect(onValueCallbacks.has(workspacePath)).toBe(true));

    act(() => {
      onValueCallbacks.get(workspacePath)?.(
        snapshotFor({
          sections: {
            displays: false,
            team: false,
          },
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId("workspace-status")).toHaveTextContent("ready"),
    );
    expect(screen.getByTestId("workspace-displays")).toHaveTextContent("no");
  });

  it("preserves the last workspace configuration when its listener errors", async () => {
    localStorage.setItem("loggedIn", "true");
    localStorage.setItem("user", "Test User");
    localStorage.setItem("database", "main");

    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(loggedInHumanBootstrap);

    renderProvider(<ContextProbe />);

    const workspacePath = "churches/church-1/data/currentServiceWorkspace";
    await waitFor(() => expect(onValueCallbacks.has(workspacePath)).toBe(true));
    act(() => {
      onValueCallbacks.get(workspacePath)?.(
        snapshotFor({ sections: { displays: false } }),
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId("workspace-displays")).toHaveTextContent("no"),
    );
    act(() => {
      onValueErrorCallbacks.get(workspacePath)?.(new Error("listener failed"));
    });

    expect(screen.getByTestId("workspace-displays")).toHaveTextContent("no");
    expect(screen.getByTestId("workspace-status")).toHaveTextContent("ready");
  });

  it("keeps a live YouTube connection after integrations listen failure and retries later", async () => {
    jest.useFakeTimers();
    localStorage.setItem("loggedIn", "true");
    localStorage.setItem("user", "Test User");
    localStorage.setItem("database", "main");

    (authApi.getAuthBootstrap as jest.Mock).mockResolvedValue(loggedInHumanBootstrap);

    renderProvider(<ContextProbe />);

    const integrationsPath = "churches/church-1/data/integrations";

    await waitFor(() =>
      expect(onValueCallbacks.has(integrationsPath)).toBe(true),
    );

    act(() => {
      onValueCallbacks.get(integrationsPath)?.(
        snapshotFor({
          youtube: {
            enabled: true,
            connected: true,
            accountLabel: "Church Live",
            lastError: "",
          },
        }),
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId("youtube-connected")).toHaveTextContent("yes"),
    );

    const listenCallsBeforeFailure = onValueMock.mock.calls.filter(
      ([target]) => target.path === integrationsPath,
    ).length;
    const tokenCallsBeforeFailure = (authApi.getSharedDataToken as jest.Mock)
      .mock.calls.length;

    act(() => {
      onValueErrorCallbacks
        .get(integrationsPath)
        ?.(new Error("listener failed"));
    });

    expect(screen.getByTestId("youtube-connected")).toHaveTextContent("yes");
    expect(screen.getByTestId("integrations-status")).toHaveTextContent(
      "ready",
    );

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    await waitFor(() =>
      expect(
        onValueMock.mock.calls.filter(
          ([target]) => target.path === integrationsPath,
        ).length,
      ).toBeGreaterThan(listenCallsBeforeFailure),
    );
    // First slow recovery is listen-only; remint waits for later recoveries.
    expect((authApi.getSharedDataToken as jest.Mock).mock.calls.length).toBe(
      tokenCallsBeforeFailure,
    );

    jest.useRealTimers();
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
    setPendingDesktopEmailResendState(null);
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
    (authApi.resendEmailCode as jest.Mock).mockReset();
    (authApi.resendEmailCode as jest.Mock).mockResolvedValue({
      success: true,
      requiresEmailCode: true,
      pendingAuthId: "pending-auth-code-next",
    });
    signInWithEmailAndPasswordMock.mockReset();
    signInWithEmailAndPasswordMock.mockResolvedValue({
      user: mockHumanAuth.currentUser,
    });
    signInWithPopupMock.mockReset();
    signInWithPopupMock.mockResolvedValue({ user: mockHumanAuth.currentUser });
    getRedirectResultMock.mockReset();
    signInWithRedirectMock.mockReset();
    getRedirectResultMock.mockResolvedValue(null);
    signInWithRedirectMock.mockResolvedValue(undefined);
    fetchSignInMethodsForEmailMock.mockReset();
    fetchSignInMethodsForEmailMock.mockResolvedValue([]);
    linkWithCredentialMock.mockReset();
    linkWithCredentialMock.mockResolvedValue({ success: true });
    reloadMock.mockReset();
    reloadMock.mockResolvedValue(undefined);
    googleCredentialFromErrorMock.mockReset();
    microsoftCredentialFromErrorMock.mockReset();
    googleCredentialFactoryMock.mockClear();
    (environmentUtils.isElectron as jest.Mock).mockReturnValue(false);
    (environmentUtils.isPackagedElectronRenderer as jest.Mock).mockReturnValue(
      false,
    );
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

  it("silently restores a server session for API retries from a persisted Firebase user", async () => {
    renderProvider(<ContextProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("session-kind")).toHaveTextContent("none");
    });

    const persistedUser = {
      uid: "user-restore",
      getIdToken: jest.fn(() => Promise.resolve("firebase-retry-token")),
      providerData: [{ providerId: "google.com" }],
    };
    mockHumanAuth.currentUser = persistedUser;

    let recovered = false;
    await act(async () => {
      recovered = await requestAuthRecovery();
    });

    expect(recovered).toBe(true);
    expect(persistedUser.getIdToken).toHaveBeenCalledWith(true);
    expect(authApi.createHumanSession).toHaveBeenCalledWith(
      expect.objectContaining({
        idToken: "firebase-retry-token",
        requestNewCode: false,
      }),
      { notifyAuthError: false },
    );
    await waitFor(() => {
      expect(screen.getByTestId("session-kind")).toHaveTextContent("human");
    });
    expect(screen.getByTestId("church-id")).toHaveTextContent("church-1");
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

  it("shows password-appropriate guidance when password auth fails", async () => {
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
        "Could not sign in with that email and password. Check your information and try again.",
      );
    });
    expect(authApi.createHumanSession).not.toHaveBeenCalled();
  });

  it.each([
    ["google", "Google sign in", "Could not sign in with Google. Please try again."],
    ["microsoft", "Microsoft sign in", "Could not sign in with Microsoft. Please try again."],
  ] as const)(
    "passes the %s method into the Firebase sign-in mapper",
    async (method, button, expectedMessage) => {
      signInWithPopupMock.mockRejectedValueOnce(
        Object.assign(new Error("unrecognized provider failure"), {
          code: "auth/unknown-oauth-error",
        }),
      );

      renderProvider(<AuthActionsProbe />);

      await waitFor(() => {
        expect(screen.getByTestId("probe-auth-status")).toHaveTextContent("online");
      });
      fireEvent.click(screen.getByRole("button", { name: button }));

      await waitFor(() => {
        expect(screen.getByTestId("probe-auth-error")).toHaveTextContent(
          expectedMessage,
        );
      });
      expect(screen.getByTestId("probe-auth-error")).not.toHaveTextContent(
        /email|password/i,
      );
      expect(authApi.createHumanSession).not.toHaveBeenCalled();
      expect(signInWithPopupMock).toHaveBeenCalledWith(
        mockHumanAuth,
        expect.objectContaining({
          providerId: method === "google" ? "google.com" : "microsoft.com",
        }),
      );
    },
  );

  it("falls back to redirect when the provider popup is blocked", async () => {
    signInWithPopupMock.mockRejectedValueOnce(
      Object.assign(new Error("popup blocked"), {
        code: "auth/popup-blocked",
      }),
    );

    renderProvider(<AuthActionsProbe />, ["/login"]);

    await waitFor(() => {
      expect(screen.getByTestId("probe-auth-status")).toHaveTextContent("online");
    });

    fireEvent.click(screen.getByRole("button", { name: "Google sign in" }));

    await waitFor(() => {
      expect(signInWithRedirectMock).toHaveBeenCalled();
    });
    expect(getPendingProviderRedirectState()).toEqual({
      method: "google",
      returnPath: "/home",
    });
    expect(screen.getByTestId("probe-auth-error")).toHaveTextContent("none");
  });

  it("uses provider-aware copy when a redirect sign-in does not complete", async () => {
    renderProvider(<AuthActionsProbe />, ["/login"]);

    await waitFor(() => {
      expect(screen.getByTestId("probe-auth-status")).toHaveTextContent("online");
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Complete redirect sign in" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-auth-error")).toHaveTextContent(
        "Google sign-in didn't finish. Try again.",
      );
    });
  });

  it("completes a pending redirect and preserves its return path", async () => {
    const providerUser = {
      uid: "redirect-user",
      getIdToken: jest.fn(() => Promise.resolve("redirect-id-token")),
    };
    setPendingProviderRedirectState({
      method: "google",
      returnPath: "/controller/bible?search=John%203:16",
    });
    getRedirectResultMock.mockResolvedValueOnce({ user: providerUser });

    renderProvider(<AuthActionsProbe />, ["/login"]);

    await waitFor(() => {
      expect(screen.getByTestId("probe-auth-status")).toHaveTextContent("online");
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Complete redirect sign in" }),
    );

    await waitFor(() => {
      expect(authApi.createHumanSession).toHaveBeenCalledWith(
        expect.objectContaining({ idToken: "redirect-id-token" }),
      );
    });
    expect(getPendingProviderRedirectState()).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("path")).toHaveTextContent(
        "/controller/bible",
      );
    });
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

  it("blocks popup provider auth in packaged Electron renderer", async () => {
    (environmentUtils.isPackagedElectronRenderer as jest.Mock).mockReturnValue(
      true,
    );
    renderProvider(<AuthActionsProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("probe-auth-status")).toHaveTextContent("online");
    });

    fireEvent.click(screen.getByRole("button", { name: "Google sign in" }));

    await waitFor(() => {
      expect(screen.getByTestId("probe-auth-error")).toHaveTextContent(
        "Provider sign-in opens in your browser from the desktop app. Use Continue with Google or Microsoft on the sign-in screen.",
      );
    });
    expect(signInWithPopupMock).not.toHaveBeenCalled();
    expect(authApi.createHumanSession).not.toHaveBeenCalled();
  });

  it("resends email code with desktop broker handshake in Electron when no Firebase user exists", async () => {
    (environmentUtils.isElectron as jest.Mock).mockReturnValue(true);
    mockHumanAuth.currentUser = null;
    setPendingDesktopEmailResendState({
      desktopAuthId: "desktop-auth-1",
      desktopAuthSecret: "desktop-secret-1",
    });
    renderProvider(
      <>
        <AuthActionsProbe />
        <CodeActionsProbe />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("probe-auth-status")).toHaveTextContent("online");
    });

    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));

    await waitFor(() => {
      expect(authApi.resendEmailCode).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingAuthId: "pending-auth-code",
          desktopAuthId: "desktop-auth-1",
          desktopAuthSecret: "desktop-secret-1",
        }),
      );
    });
    expect(getPendingDesktopEmailResendState()).toEqual({
      desktopAuthId: "desktop-auth-1",
      desktopAuthSecret: "desktop-secret-1",
    });
  });
});
