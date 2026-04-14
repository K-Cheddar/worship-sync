import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  onAuthStateChanged,
  signInWithPopup,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type AuthCredential,
  type User,
} from "firebase/auth";
import {
  Database,
  ref,
  onValue,
  Unsubscribe,
  set,
  onDisconnect,
} from "firebase/database";
import { Instance, TimerInfo } from "../types";
import { useNavigate, useLocation } from "react-router-dom";
import { useDispatch } from "../hooks";
import generateRandomId from "../utils/generateRandomId";
import { syncTimers } from "../store/timersSlice";
import {
  AuthBootstrap,
  AuthApiError,
  createChurchAccount,
  createHumanSession,
  forgotPassword as forgotPasswordRequest,
  getAuthBootstrap,
  getSharedDataToken,
  logoutSession,
  unlinkWorkstation as unlinkWorkstationRequest,
  SessionKind,
  updateWorkstationOperator,
  updateHumanProfile,
  verifyEmailCode as verifyEmailCodeRequest,
  resendEmailCode as resendEmailCodeRequest,
} from "../api/auth";
import type { ChurchBranding } from "../api/authTypes";

import {
  BibleDisplayInfo,
  OverlayInfo,
  Presentation as PresentationType,
} from "../types";
import { ActionCreators } from "redux-undo";
import {
  getForgotPasswordErrorMessage,
  getSignInFlowErrorMessage,
  getVerifyEmailCodeErrorMessage,
  SIGN_IN_UNEXPECTED_RESPONSE,
} from "../utils/authUserMessages";
import {
  clearCsrfToken,
  clearDisplayToken,
  clearLegacyWorkstationOperatorName,
  clearOperatorNameStorage,
  clearWorkstationSessionOperatorName,
  clearWorkstationToken,
  setCsrfToken,
  getDisplayToken,
  getOperatorName,
  getOrCreateDeviceId,
  getPendingLinkCredentialState,
  getPendingLinkState,
  getWorkstationSessionOperatorName,
  getWorkstationToken,
  setLastSignInMethod,
  setPendingLinkCredentialState,
  setPendingLinkState,
  setOperatorNameStorage,
  setWorkstationSessionOperatorName,
} from "../utils/authStorage";
import {
  getHumanAuth,
  getSharedDataAuth,
  getSharedDataDatabase,
} from "../firebase/apps";
import { getChurchDataPath } from "../utils/firebasePaths";
import { MAX_INITIAL_SESSION_RETRIES } from "../constants";
import { backoff } from "../utils/generalUtils";
import { getTrustedDeviceLabel } from "../utils/deviceInfo";
import { getHumanPostAuthPath } from "../utils/authRedirectPath";
import { resolveAccountDisplayNameForAudit } from "../utils/displayName";
import { setAuditSnapshot } from "../utils/pouchAudit";
import {
  emptyChurchBranding,
  normalizeChurchBranding,
} from "../utils/churchBranding";

/** Firebase client calls are Promise-like in production but may return void in tests. */
function signOutFirebaseAuth(auth: Auth): Promise<void> {
  return Promise.resolve(signOut(auth)).catch(() => undefined);
}

function settleFirebaseWrite<T>(value: T | PromiseLike<T>): Promise<void> {
  return Promise.resolve(value).catch(() => undefined);
}

type HumanFirebaseAuthResult =
  | { status: "success"; user: User }
  | { status: "requires-existing-method" };

const getCredentialJsonValue = (
  credentialJson: Record<string, unknown>,
  ...keys: string[]
) => {
  for (const key of keys) {
    const value = credentialJson[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
};

const serializePendingLinkCredential = (
  providerId: "google.com" | "microsoft.com",
  credential: AuthCredential,
) => {
  const credentialJson =
    typeof (credential as { toJSON?: () => unknown }).toJSON === "function"
      ? (credential as { toJSON: () => unknown }).toJSON()
      : null;
  if (
    typeof credentialJson !== "string" &&
    (typeof credentialJson !== "object" || credentialJson === null)
  ) {
    return null;
  }
  return {
    providerId,
    credentialJson,
  } as const;
};

const restorePendingLinkCredential = (
  storedCredential: ReturnType<typeof getPendingLinkCredentialState>,
) => {
  if (!storedCredential) {
    return null;
  }
  const credentialJson =
    typeof storedCredential.credentialJson === "string"
      ? JSON.parse(storedCredential.credentialJson)
      : storedCredential.credentialJson;
  if (typeof credentialJson !== "object" || credentialJson === null) {
    return null;
  }

  const idToken = getCredentialJsonValue(
    credentialJson,
    "idToken",
    "oauthIdToken",
  );
  const accessToken = getCredentialJsonValue(
    credentialJson,
    "accessToken",
    "oauthAccessToken",
  );

  if (storedCredential.providerId === "google.com") {
    if (!idToken && !accessToken) {
      return null;
    }
    return GoogleAuthProvider.credential(idToken || null, accessToken || null);
  }

  if (!idToken && !accessToken) {
    return null;
  }

  const provider = new OAuthProvider("microsoft.com");
  if (idToken) {
    return provider.credential({
      idToken,
      accessToken: accessToken || undefined,
    });
  }
  return provider.credential({
    accessToken: accessToken || undefined,
  });
};

const PASSWORD_SIGN_IN_FALLBACK_ERROR_CODES = new Set([
  "auth/invalid-credential",
  "auth/invalid-login-credentials",
  "auth/wrong-password",
  "auth/user-not-found",
]);

type LoginStateType = "idle" | "loading" | "error" | "success" | "guest";
type BootstrapStatus = "loading" | "ready";
type AuthServerStatus = "checking" | "online" | "offline";
type ChurchBrandingStatus = "loading" | "ready";
export type HumanAuthMethod = "password" | "google" | "microsoft";

export type AccessType = "full" | "music" | "view";
type GlobalInfoContextType = {
  authenticateHumanWithFirebase: ({
    method,
    email,
    password,
  }: {
    method: HumanAuthMethod;
    email?: string;
    password?: string;
  }) => Promise<HumanFirebaseAuthResult>;
  login: ({
    method,
    email,
    password,
  }: {
    method: HumanAuthMethod;
    email?: string;
    password?: string;
  }) => Promise<{ requiresEmailCode?: boolean; pendingAuthId?: string }>;
  verifyEmailCode: ({
    pendingAuthId,
    code,
  }: {
    pendingAuthId: string;
    code: string;
  }) => Promise<boolean>;
  resendEmailCode: ({
    pendingAuthId,
  }: {
    pendingAuthId: string;
  }) => Promise<{ pendingAuthId?: string }>;
  createChurchAccount: ({
    method,
    churchName,
    adminName,
    adminEmail,
    password,
  }: {
    method: HumanAuthMethod;
    churchName: string;
    adminName: string;
    adminEmail?: string;
    password?: string;
  }) => Promise<{ requiresEmailCode?: boolean; pendingAuthId?: string }>;
  forgotPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  unlinkCurrentWorkstation: () => Promise<void>;
  /** Shared workstation: clear operator for handoff; keeps device link and church session. */
  endWorkstationOperatorSession: () => Promise<void>;
  enterGuestMode: (nextPath?: string) => void;
  exitGuestMode: (nextPath?: string) => void;
  loginState: LoginStateType;
  bootstrapStatus: BootstrapStatus;
  authServerStatus: AuthServerStatus;
  authServerRetryCount: number;
  sessionKind: SessionKind;
  userId: string;
  user: string;
  /** Account email when session has a human user (from bootstrap). */
  userEmail: string;
  linkedAuthMethods: string[];
  pendingLinkState: ReturnType<typeof getPendingLinkState>;
  clearPendingLinkState: () => void;
  database: string;
  uploadPreset: string;
  setLoginState: (val: LoginStateType) => void;
  firebaseDb: Database | undefined;
  hostId: string;
  activeInstances: Instance[];
  access: AccessType;
  churchId: string;
  churchName: string;
  churchStatus: string;
  recoveryEmail: string;
  churchBranding: ChurchBranding;
  churchBrandingStatus: ChurchBrandingStatus;
  role: string;
  authError: string;
  /** Set when session restore needs email verification; Login should open the code step. */
  pendingEmailVerificationId: string | null;
  clearPendingEmailVerification: () => void;
  operatorName: string;
  device: AuthBootstrap["device"] | null;
  setOperatorName: (value: string) => void;
  refreshAuthBootstrap: () => Promise<void>;
  refreshPresentationListeners: () => void;
  updateSelfDisplayName: (displayName: string) => Promise<boolean>;
};

export const GlobalInfoContext = createContext<GlobalInfoContextType | null>(
  null
);

type globalFireBaseInfoType = {
  db: Database | undefined;
  user: string;
  database: string;
  churchId: string;
};

export const globalFireDbInfo: globalFireBaseInfoType = {
  db: undefined,
  user: "Demo",
  database: "demo",
  churchId: "",
};

const HOST_ID_STORAGE_KEY = "worshipsync_host_id";

const getStableHostId = () => {
  const win = window as unknown as { __globalHostId?: string };
  if (win.__globalHostId) {
    return win.__globalHostId;
  }

  let hostId = "";
  try {
    hostId = window.sessionStorage.getItem(HOST_ID_STORAGE_KEY) || "";
  } catch {
    hostId = "";
  }

  if (!hostId) {
    hostId = generateRandomId();
    try {
      window.sessionStorage.setItem(HOST_ID_STORAGE_KEY, hostId);
    } catch {
      // Ignore sessionStorage failures and continue with the in-memory id.
    }
  }

  win.__globalHostId = hostId;
  return hostId;
};

export const globalHostId = getStableHostId();

const GlobalInfoProvider = ({ children }: { children: React.ReactNode }) => {
  const [firebaseDb, setFirebaseDb] = useState<Database | undefined>();
  const [isSharedDataReady, setIsSharedDataReady] = useState(false);
  const [loginState, setLoginState] = useState<LoginStateType>("loading");
  const [bootstrapStatus, setBootstrapStatus] =
    useState<BootstrapStatus>("loading");
  const bootstrapStatusRef = useRef(bootstrapStatus);
  bootstrapStatusRef.current = bootstrapStatus;
  const [authServerStatus, setAuthServerStatus] =
    useState<AuthServerStatus>("checking");
  const [authServerRetryCount, setAuthServerRetryCount] = useState(0);
  const [sessionKind, setSessionKind] = useState<SessionKind>(null);
  const [userId, setUserId] = useState("");
  const [user, setUser] = useState("Demo");
  const [userEmail, setUserEmail] = useState("");
  const [linkedAuthMethods, setLinkedAuthMethods] = useState<string[]>([]);
  const [pendingLinkState, setPendingLinkStateLocal] = useState<
    ReturnType<typeof getPendingLinkState>
  >(null);
  const [database, setDatabase] = useState("demo");
  const [uploadPreset, setUploadPreset] = useState("bpqu4ma5");
  const [access, setAccess] = useState<AccessType>("full");
  const [churchId, setChurchId] = useState("");
  const [churchName, setChurchName] = useState("");
  const [churchStatus, setChurchStatus] = useState("active");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [churchBranding, setChurchBranding] = useState<ChurchBranding>(
    emptyChurchBranding()
  );
  const [churchBrandingStatus, setChurchBrandingStatus] =
    useState<ChurchBrandingStatus>("loading");
  const [role, setRole] = useState("");
  const [authError, setAuthError] = useState("");
  const [pendingEmailVerificationId, setPendingEmailVerificationId] =
    useState<string | null>(null);
  const [operatorName, setOperatorNameState] = useState("");
  const [device, setDevice] = useState<AuthBootstrap["device"] | null>(null);
  /** Firebase Auth profile display name; kept in sync for audit + toolbar (see UserSection). */
  const [humanAuthDisplayName, setHumanAuthDisplayName] = useState("");

  const [activeInstances, setActiveInstances] = useState<Instance[]>([]);
  const pendingLinkCredentialRef = useRef<AuthCredential | null>(null);
  const instanceRef = useRef<ReturnType<typeof ref> | null>(null);
  const hasRehydratedTimersRef = useRef(false);
  const sharedDataAuthRequestIdRef = useRef(0);
  const sharedDataAuthChainRef = useRef<Promise<void>>(Promise.resolve());
  const location = useLocation();
  const isOnController = useMemo(() => {
    const path = location.pathname;
    return (
      path.startsWith("/controller") || path.startsWith("/overlay-controller")
    );
  }, [location.pathname]);

  const hostId = useMemo(() => globalHostId, []);

  useEffect(() => {
    if (sessionKind !== "human") {
      setHumanAuthDisplayName("");
      return;
    }
    const auth = getHumanAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      setHumanAuthDisplayName(u?.displayName?.trim() || "");
    });
    return () => unsub();
  }, [sessionKind]);

  const sharedDataSessionScope = useMemo(
    () =>
      JSON.stringify({
        loginState,
        sessionKind,
        churchId,
        database,
        access,
        userId,
        deviceId: device?.deviceId || "",
      }),
    [access, churchId, database, device?.deviceId, loginState, sessionKind, userId]
  );

  useEffect(() => {
    setAuditSnapshot({
      userId,
      sessionKind,
      operatorName,
      deviceLabel: device?.label?.trim() || "",
      userEmail,
      displayName: resolveAccountDisplayNameForAudit({
        sessionKind,
        user,
        firebaseHumanDisplayName: humanAuthDisplayName,
      }),
    });
  }, [
    userId,
    sessionKind,
    operatorName,
    device?.label,
    userEmail,
    user,
    humanAuthDisplayName,
  ]);

  const onValueRef = useRef<{
    projectorInfo: Unsubscribe | undefined;
    monitorInfo: Unsubscribe | undefined;
    streamInfo: Unsubscribe | undefined;
    stream_bibleInfo: Unsubscribe | undefined;
    stream_participantOverlayInfo: Unsubscribe | undefined;
    stream_stbOverlayInfo: Unsubscribe | undefined;
    stream_qrCodeOverlayInfo: Unsubscribe | undefined;
    stream_imageOverlayInfo: Unsubscribe | undefined;
    stream_formattedTextDisplayInfo: Unsubscribe | undefined;
    stream_itemContentBlocked: Unsubscribe | undefined;
    timerInfo: Unsubscribe | undefined;
  }>({
    projectorInfo: undefined,
    monitorInfo: undefined,
    streamInfo: undefined,
    stream_bibleInfo: undefined,
    stream_participantOverlayInfo: undefined,
    stream_stbOverlayInfo: undefined,
    stream_qrCodeOverlayInfo: undefined,
    stream_imageOverlayInfo: undefined,
    stream_formattedTextDisplayInfo: undefined,
    stream_itemContentBlocked: undefined,
    timerInfo: undefined,
  });

  const storageListenerCleanupRef = useRef<(() => void) | undefined>(undefined);
  const refreshAuthBootstrapPromiseRef = useRef<Promise<void> | null>(null);

  const navigate = useNavigate();
  const dispatch = useDispatch();

  const waitForHumanAuthUser = useCallback(async () => {
    const auth = getHumanAuth();
    if (auth.currentUser) {
      return auth.currentUser;
    }
    return new Promise<ReturnType<typeof getHumanAuth>["currentUser"]>(
      (resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
          unsubscribe();
          resolve(currentUser);
        });
      }
    );
  }, []);

  const clearPendingLinkState = useCallback(() => {
    pendingLinkCredentialRef.current = null;
    setPendingLinkStateLocal(null);
    setPendingLinkCredentialState(null);
    setPendingLinkState(null);
  }, []);

  const getProviderForMethod = useCallback(
    (method: Exclude<HumanAuthMethod, "password">) => {
      if (method === "google") {
        return new GoogleAuthProvider();
      }
      const provider = new OAuthProvider("microsoft.com");
      provider.setCustomParameters({ tenant: "common" });
      return provider;
    },
    []
  );

  const linkPendingCredentialIfPresent = useCallback(async (authUser: User) => {
    let credentialToLink = pendingLinkCredentialRef.current;
    if (!credentialToLink) {
      credentialToLink = restorePendingLinkCredential(
        getPendingLinkCredentialState()
      );
      if (!credentialToLink) {
        clearPendingLinkState();
        return;
      }
      pendingLinkCredentialRef.current = credentialToLink;
    }
    pendingLinkCredentialRef.current = null;
    try {
      await linkWithCredential(authUser, credentialToLink);
      clearPendingLinkState();
    } catch (error) {
      clearPendingLinkState();
      console.error("Could not link auth provider:", error);
    }
  }, [clearPendingLinkState]);

  useEffect(() => {
    const storedState = getPendingLinkState();
    const storedCredential = getPendingLinkCredentialState();
    const restoredCredential = (() => {
      try {
        return restorePendingLinkCredential(storedCredential);
      } catch {
        return;
      }
    })();

    if (
      storedState &&
      storedCredential &&
      restoredCredential &&
      storedState.providerId === storedCredential.providerId
    ) {
      pendingLinkCredentialRef.current = restoredCredential;
      setPendingLinkStateLocal(storedState);
      return;
    }

    if (storedState || storedCredential) {
      clearPendingLinkState();
    }
  }, [clearPendingLinkState]);

  const persistPendingLinkFromError = useCallback(
    async (
      error: unknown,
      method: Exclude<HumanAuthMethod, "password">,
      fallbackEmail?: string,
    ) => {
      const errorCode =
        typeof error === "object" &&
          error &&
          "code" in error &&
          typeof (error as { code?: unknown }).code === "string"
          ? ((error as { code: string }).code || "")
          : "";
      if (errorCode !== "auth/account-exists-with-different-credential") {
        return false;
      }

      const auth = getHumanAuth();
      const collisionEmail = String(
        (error as { customData?: { email?: string } })?.customData?.email ||
        fallbackEmail ||
        "",
      ).trim();
      const requiredMethods = collisionEmail
        ? await fetchSignInMethodsForEmail(auth, collisionEmail)
        : [];
      const providerId =
        method === "google" ? "google.com" : "microsoft.com";
      const nextCredential =
        method === "google"
          ? GoogleAuthProvider.credentialFromError(error as Error)
          : OAuthProvider.credentialFromError(error as Error);

      if (!nextCredential) {
        clearPendingLinkState();
        return false;
      }

      pendingLinkCredentialRef.current = nextCredential;
      const serializedCredential = serializePendingLinkCredential(
        providerId,
        nextCredential,
      );
      if (!serializedCredential) {
        clearPendingLinkState();
        return false;
      }

      const nextState = {
        email: collisionEmail,
        providerId,
        requiredMethods,
      } as const;

      setPendingLinkCredentialState(serializedCredential);
      setPendingLinkStateLocal(nextState);
      setPendingLinkState(nextState);
      setAuthError(
        requiredMethods.includes("password")
          ? "This email is already in use. Sign in with your password to link this provider."
          : "This email is already in use. Sign in with the existing method to link this provider."
      );
      return true;
    },
    [clearPendingLinkState],
  );

  const authenticateHumanWithFirebase = useCallback(
    async ({
      method,
      email,
      password,
    }: {
      method: HumanAuthMethod;
      email?: string;
      password?: string;
    }): Promise<HumanFirebaseAuthResult> => {
      const auth = getHumanAuth();
      try {
        let firebaseUser: User;
        if (method === "password") {
          const trimmedEmail = String(email || "").trim();
          const nextPassword = String(password || "");
          if (!trimmedEmail || !nextPassword) {
            throw new Error("Enter your email and password to continue.");
          }
          const credential = await signInWithEmailAndPassword(
            auth,
            trimmedEmail,
            nextPassword,
          );
          firebaseUser = credential.user;
        } else {
          const provider = getProviderForMethod(method);
          const credential = await signInWithPopup(auth, provider);
          firebaseUser = credential.user;
        }

        await linkPendingCredentialIfPresent(firebaseUser);
        return {
          status: "success",
          user: firebaseUser,
        };
      } catch (error) {
        if (
          method !== "password" &&
          (await persistPendingLinkFromError(error, method, email))
        ) {
          return { status: "requires-existing-method" };
        }
        throw error;
      }
    },
    [
      getProviderForMethod,
      linkPendingCredentialIfPresent,
      persistPendingLinkFromError,
    ],
  );

  const isReachabilityError = useCallback((error: unknown) => {
    return error instanceof AuthApiError && error.isReachabilityError;
  }, []);

  const updateFromRemote = useCallback(
    (data: any) => {
      type updateInfoChildType = {
        info: PresentationType | BibleDisplayInfo | OverlayInfo | TimerInfo;
        updateAction: string;
      };

      const updateInfo = {
        projectorInfo: {
          info: data.projectorInfo,
          updateAction: "debouncedUpdateProjector",
        },
        monitorInfo: {
          info: data.monitorInfo,
          updateAction: "debouncedUpdateMonitor",
        },
        streamInfo: {
          info: data.streamInfo,
          updateAction: "debouncedUpdateStream",
        },
        stream_bibleInfo: {
          info: data.stream_bibleInfo,
          updateAction: "debouncedUpdateBibleDisplayInfo",
        },
        stream_participantOverlayInfo: {
          info: data.stream_participantOverlayInfo,
          updateAction: "debouncedUpdateParticipantOverlayInfo",
        },
        stream_stbOverlayInfo: {
          info: data.stream_stbOverlayInfo,
          updateAction: "debouncedUpdateStbOverlayInfo",
        },
        stream_qrCodeOverlayInfo: {
          info: data.stream_qrCodeOverlayInfo,
          updateAction: "debouncedUpdateQrCodeOverlayInfo",
        },
        stream_imageOverlayInfo: {
          info: data.stream_imageOverlayInfo,
          updateAction: "debouncedUpdateImageOverlayInfo",
        },
        stream_formattedTextDisplayInfo: {
          info: data.stream_formattedTextDisplayInfo,
          updateAction: "debouncedUpdateFormattedTextDisplayInfo",
        },
        stream_itemContentBlocked: {
          info: data.stream_itemContentBlocked,
          updateAction: "debouncedUpdateStreamItemContentBlocked",
        },
        timerInfo: {
          info: data.timerInfo,
          updateAction: "debouncedUpdateTimerInfo",
        },
      };

      const keys = Object.keys(updateInfo);
      for (const key of keys) {
        const _key = key as keyof typeof updateInfo; // Define type
        const obj = updateInfo[_key];
        const { info, updateAction } = obj as updateInfoChildType;

        const isBlockedKey = _key === "stream_itemContentBlocked";
        if (isBlockedKey ? info === undefined : !info) continue;
        dispatch({ type: updateAction, payload: isBlockedKey ? Boolean(info) : info });
      }
    },
    [dispatch]
  );

  const activeInstanceName = useMemo(() => {
    const trimmedOperatorName = operatorName.trim();
    const trimmedUser = user.trim();
    const trimmedDeviceLabel = device?.label?.trim() || "";

    if (sessionKind === "workstation") {
      return trimmedOperatorName || trimmedUser || trimmedDeviceLabel || "Operator";
    }

    return trimmedUser || trimmedOperatorName || trimmedDeviceLabel || "Operator";
  }, [device?.label, operatorName, sessionKind, user]);

  const applyBootstrap = useCallback((
    bootstrap?: AuthBootstrap | null,
    options?: { clearWorkstationSessionOperator?: boolean }
  ) => {
    if (!bootstrap?.authenticated) {
      setLoginState("idle");
      setSessionKind(null);
      setUserId("");
      setUser("");
      setUserEmail("");
      setLinkedAuthMethods([]);
      setDatabase("");
      setUploadPreset("bpqu4ma5");
      setAccess("full");
      setChurchId("");
      setChurchName("");
      setChurchStatus("active");
      setRecoveryEmail("");
      setRole("");
      setOperatorNameState("");
      setDevice(null);
      clearCsrfToken();
      if (options?.clearWorkstationSessionOperator) {
        clearWorkstationSessionOperatorName();
      }
      localStorage.setItem("loggedIn", "false");
      localStorage.removeItem("user");
      localStorage.removeItem("database");
      localStorage.setItem("upload_preset", "bpqu4ma5");
      localStorage.setItem("access", "full");
      globalFireDbInfo.user = "";
      globalFireDbInfo.database = "";
      globalFireDbInfo.churchId = "";
      return;
    }

    setLoginState("success");
    setSessionKind(bootstrap.sessionKind);
    setUserId(bootstrap.user?.uid || "");
    setUserEmail(
      bootstrap.user?.primaryEmail?.trim() || bootstrap.user?.email?.trim() || ""
    );
    setLinkedAuthMethods(bootstrap.user?.linkedMethods || []);
    const humanToolbarLabel =
      bootstrap.user?.displayName?.trim() ||
      bootstrap.user?.primaryEmail?.trim() ||
      bootstrap.user?.email?.trim() ||
      "";
    const workstationSessionOperator = getWorkstationSessionOperatorName().trim();
    const toolbarDisplayName =
      bootstrap.sessionKind === "workstation"
        ? workstationSessionOperator ||
        bootstrap.device?.label?.trim() ||
        "Operator"
        : humanToolbarLabel ||
        bootstrap.device?.operatorName ||
        bootstrap.device?.label ||
        "Operator";
    setUser(toolbarDisplayName);
    setDatabase(bootstrap.database || "demo");
    setUploadPreset(bootstrap.uploadPreset || "bpqu4ma5");
    setAccess((bootstrap.appAccess as AccessType) || "view");
    setChurchId(bootstrap.churchId || "");
    setChurchName(bootstrap.churchName?.trim() || "");
    setChurchStatus(bootstrap.churchStatus || "active");
    setRecoveryEmail(bootstrap.recoveryEmail || "");
    setRole(bootstrap.role || "");
    if (bootstrap.sessionKind === "workstation") {
      clearLegacyWorkstationOperatorName();
      setOperatorNameState(workstationSessionOperator);
    } else {
      setOperatorNameState(bootstrap.device?.operatorName || getOperatorName());
    }
    setDevice(bootstrap.device || null);
    if (bootstrap.csrfToken) {
      setCsrfToken(bootstrap.csrfToken);
    } else {
      clearCsrfToken();
    }
    localStorage.setItem("loggedIn", "true");
    localStorage.setItem("user", toolbarDisplayName);
    localStorage.setItem("database", bootstrap.database || "demo");
    localStorage.setItem("upload_preset", bootstrap.uploadPreset || "bpqu4ma5");
    localStorage.setItem("access", (bootstrap.appAccess as AccessType) || "view");
    globalFireDbInfo.user = toolbarDisplayName;
    globalFireDbInfo.database = bootstrap.database || "demo";
    globalFireDbInfo.churchId = bootstrap.churchId || "";
  }, []);

  const applyOfflineBootstrapFallback = useCallback(() => {
    setAuthServerStatus("offline");
    setPendingEmailVerificationId(null);
    setLoginState((current) => (current === "loading" ? "idle" : current));
  }, []);

  const clearPendingEmailVerification = useCallback(() => {
    setPendingEmailVerificationId(null);
  }, []);

  const enterGuestMode = useCallback(
    (nextPath = "/controller") => {
      hasRehydratedTimersRef.current = false;
      setPendingEmailVerificationId(null);
      setLoginState("guest");
      setSessionKind(null);
      setUserId("");
      setUser("Demo");
      setUserEmail("");
      setDatabase("demo");
      setUploadPreset("bpqu4ma5");
      setAccess("full");
      setChurchId("");
      setChurchName("");
      setChurchStatus("active");
      setRecoveryEmail("");
      setRole("");
      setOperatorNameState("");
      setDevice(null);
      setAuthError("");
      clearCsrfToken();
      clearWorkstationSessionOperatorName();
      localStorage.setItem("loggedIn", "false");
      localStorage.setItem("user", "Demo");
      localStorage.setItem("database", "demo");
      localStorage.setItem("upload_preset", "bpqu4ma5");
      localStorage.setItem("access", "full");
      globalFireDbInfo.user = "Demo";
      globalFireDbInfo.database = "demo";
      globalFireDbInfo.churchId = "";
      dispatch({ type: "RESET" });
      navigate(nextPath, { replace: true });
    },
    [dispatch, navigate]
  );

  const exitGuestMode = useCallback(
    (nextPath = "/") => {
      hasRehydratedTimersRef.current = false;
      dispatch({ type: "RESET" });
      dispatch(ActionCreators.clearHistory());
      setPendingEmailVerificationId(null);
      setAuthError("");
      applyBootstrap(null);
      setFirebaseDb(undefined);
      globalFireDbInfo.db = undefined;
      navigate(nextPath, { replace: true });
    },
    [applyBootstrap, dispatch, navigate]
  );

  const refreshAuthBootstrap = useCallback(async () => {
    if (refreshAuthBootstrapPromiseRef.current) {
      await refreshAuthBootstrapPromiseRef.current;
      return;
    }

    if (bootstrapStatusRef.current !== "ready") {
      setBootstrapStatus("loading");
    }
    setAuthServerStatus("checking");
    setAuthServerRetryCount(0);
    setAuthError("");
    setPendingEmailVerificationId(null);

    const promise = (async () => {
      try {
        let bootstrap: AuthBootstrap | null = null;
        let bootstrapError: unknown = null;

        for (let attempt = 0; attempt <= MAX_INITIAL_SESSION_RETRIES; attempt++) {
          try {
            bootstrap = await getAuthBootstrap({
              workstationToken: getWorkstationToken(),
              displayToken: getDisplayToken(),
            });
            setAuthServerStatus("online");
            setAuthServerRetryCount(0);
            bootstrapError = null;
            break;
          } catch (error) {
            bootstrapError = error;
            setAuthServerRetryCount(attempt + 1);
            if (attempt === MAX_INITIAL_SESSION_RETRIES) {
              break;
            }
            await backoff(attempt, 1000, 5000);
          }
        }

        if (!bootstrap) {
          if (bootstrapError) {
            console.error("Auth bootstrap server check failed:", bootstrapError);
          }
          if (bootstrapError && isReachabilityError(bootstrapError)) {
            applyOfflineBootstrapFallback();
            return;
          }
          setAuthServerStatus("offline");
          applyBootstrap(null, { clearWorkstationSessionOperator: true });
          return;
        }

        if (bootstrap.authenticated) {
          applyBootstrap(bootstrap);
          return;
        }

        const persistedUser = await waitForHumanAuthUser();
        if (!persistedUser) {
          applyBootstrap(null, { clearWorkstationSessionOperator: true });
          return;
        }

        try {
          const idToken = await persistedUser.getIdToken(true);
          const restoredSession = await createHumanSession({
            idToken,
            deviceId: getOrCreateDeviceId(),
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            deviceLabel: getTrustedDeviceLabel(),
            requestNewCode: false,
          });

          setAuthServerStatus("online");

          if (restoredSession.bootstrap) {
            applyBootstrap(restoredSession.bootstrap);
            return;
          }

          if (
            restoredSession.requiresEmailCode &&
            restoredSession.pendingAuthId
          ) {
            setPendingEmailVerificationId(restoredSession.pendingAuthId);
          } else if (restoredSession.requiresEmailCode) {
            setAuthError("Verify this device to continue.");
          } else if (restoredSession.requiresEmailCode === false) {
            setAuthError(
              "Your sign-in code expired. Sign in again with your password to receive a new code."
            );
          }
          applyBootstrap(null, { clearWorkstationSessionOperator: true });
        } catch (error) {
          if (isReachabilityError(error)) {
            console.error("Could not reach server while restoring session:", error);
            applyOfflineBootstrapFallback();
            return;
          }

          console.error("Auth session restore failed:", error);
          setAuthError("Could not restore your session.");
          applyBootstrap(null, { clearWorkstationSessionOperator: true });
        }
      } catch (error) {
        console.error("Auth bootstrap failed:", error);
        if (isReachabilityError(error)) {
          applyOfflineBootstrapFallback();
          return;
        }
        setAuthServerStatus("offline");
        applyBootstrap(null, { clearWorkstationSessionOperator: true });
      } finally {
        setBootstrapStatus("ready");
      }
    })();

    refreshAuthBootstrapPromiseRef.current = promise;
    try {
      await promise;
    } finally {
      refreshAuthBootstrapPromiseRef.current = null;
    }
  }, [
    applyBootstrap,
    applyOfflineBootstrapFallback,
    isReachabilityError,
    waitForHumanAuthUser,
  ]);

  const refreshAuthBootstrapRef = useRef(refreshAuthBootstrap);
  refreshAuthBootstrapRef.current = refreshAuthBootstrap;

  useEffect(() => {
    localStorage.setItem("presentation", "null");
    void refreshAuthBootstrapRef.current();
  }, []);

  // Rehydrate timers from localStorage for guest mode so timers work after refresh
  useEffect(() => {
    if (loginState !== "guest" || hasRehydratedTimersRef.current) return;
    hasRehydratedTimersRef.current = true;
    try {
      const raw = localStorage.getItem("timerInfo");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          dispatch(syncTimers(parsed));
        }
      }
    } catch {
      // ignore invalid stored data
    }
  }, [loginState, dispatch]);

  // initialize firebase
  useEffect(() => {
    const auth = getSharedDataAuth();
    if (loginState !== "success") {
      sharedDataAuthRequestIdRef.current += 1;
      setFirebaseDb(undefined);
      setIsSharedDataReady(false);
      globalFireDbInfo.db = undefined;
      sharedDataAuthChainRef.current = Promise.resolve(
        sharedDataAuthChainRef.current ?? Promise.resolve()
      )
        .catch(() => undefined)
        .then(async () => {
          await signOutFirebaseAuth(auth);
        });
      return;
    }

    const requestId = ++sharedDataAuthRequestIdRef.current;
    const _db = getSharedDataDatabase();
    let cancelled = false;

    setFirebaseDb(undefined);
    setIsSharedDataReady(false);
    globalFireDbInfo.db = undefined;

    void getSharedDataToken({
      workstationToken: getWorkstationToken(),
      displayToken: getDisplayToken(),
    })
      .then((response) => {
        if (cancelled || requestId !== sharedDataAuthRequestIdRef.current) {
          return;
        }
        sharedDataAuthChainRef.current = Promise.resolve(
          sharedDataAuthChainRef.current ?? Promise.resolve()
        )
          .catch(() => undefined)
          .then(async () => {
            if (cancelled || requestId !== sharedDataAuthRequestIdRef.current) {
              return;
            }
            await signInWithCustomToken(auth, response.token);
            if (cancelled || requestId !== sharedDataAuthRequestIdRef.current) {
              return;
            }
            setFirebaseDb(_db);
            setIsSharedDataReady(true);
            globalFireDbInfo.db = _db;
          })
          .catch((error) => {
            if (cancelled || requestId !== sharedDataAuthRequestIdRef.current) {
              return;
            }
            console.error("Shared realtime sign-in error:", error);
            setFirebaseDb(undefined);
            setIsSharedDataReady(false);
            globalFireDbInfo.db = undefined;
            setAuthError("Could not connect live data.");
          });
      })
      .catch((error) => {
        if (cancelled || requestId !== sharedDataAuthRequestIdRef.current) {
          return;
        }
        console.error("Shared realtime sign-in error:", error);
        setFirebaseDb(undefined);
        setIsSharedDataReady(false);
        globalFireDbInfo.db = undefined;
        setAuthError("Could not connect live data.");
      });

    return () => {
      cancelled = true;
    };
  }, [loginState, sharedDataSessionScope]);

  // Track active instances (must run before the connection monitor below so
  // instanceRef points at the current church before .info/connected fires).
  useEffect(() => {
    if (!firebaseDb || !isSharedDataReady || loginState !== "success") return;

    const activeInstancesRef = ref(
      firebaseDb,
      getChurchDataPath(churchId, "activeInstances")
    );

    // Listen for changes in active instances
    const unsubscribe = onValue(activeInstancesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        // Clean up stale instances (older than 1 hour)
        const now = Date.now();
        const staleInstances = Object.entries(data).filter(
          ([_, instance]: [string, any]) => {
            const lastActive = new Date(instance.lastActive).getTime();
            return now - lastActive > 60 * 60 * 1000; // 1 hour
          }
        );

        // Remove stale instances
        staleInstances.forEach(([staleHostId]) => {
          const staleRef = ref(
            firebaseDb,
            getChurchDataPath(churchId, "activeInstances", staleHostId)
          );
          void settleFirebaseWrite(set(staleRef, null));
        });
        const _activeInstances = Object.values(data).filter(
          (instance: any): instance is Instance =>
            instance.isOnController &&
            now - new Date(instance.lastActive).getTime() <= 60 * 60 * 1000
        );
        setActiveInstances(_activeInstances);
      } else {
        setActiveInstances([]);
      }
    });

    // Set this instance as active only if on controller page
    instanceRef.current = ref(
      firebaseDb,
      getChurchDataPath(churchId, "activeInstances", hostId)
    );

    // Function to update the instance
    const updateInstance = () => {
      if (instanceRef.current) {
        void settleFirebaseWrite(
          set(instanceRef.current, {
            lastActive: new Date().toISOString(),
            user: activeInstanceName,
            name: activeInstanceName,
            database: database,
            hostId: hostId,
            isOnController,
            sessionKind,
            deviceLabel: device?.label || null,
          })
        );
      }
    };

    // Initial setup
    updateInstance();

    // Set up periodic updates while the component is mounted
    const updateInterval = setInterval(updateInstance, 30 * 60 * 1000); // Update every 30 minutes

    // Remove this instance when the user disconnects
    if (instanceRef.current) {
      onDisconnect(instanceRef.current).remove();
    }

    // Cleanup function
    return () => {
      unsubscribe();
      clearInterval(updateInterval);
      const staleInstanceRef = instanceRef.current;
      instanceRef.current = null;
      if (staleInstanceRef) {
        void settleFirebaseWrite(onDisconnect(staleInstanceRef).cancel());
        void settleFirebaseWrite(set(staleInstanceRef, null));
      }
    };
  }, [
    activeInstanceName,
    churchId,
    database,
    device?.label,
    firebaseDb,
    hostId,
    isSharedDataReady,
    isOnController,
    loginState,
    sessionKind,
  ]);

  // Monitor connection state and handle reconnection
  useEffect(() => {
    if (!firebaseDb || !isSharedDataReady || loginState !== "success") return;

    const connectedRef = ref(firebaseDb, ".info/connected");
    const unsubscribe = onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        // When we reconnect, re-establish the active instance if we're on the controller page
        if (isOnController && instanceRef.current) {
          void settleFirebaseWrite(
            set(instanceRef.current, {
              lastActive: new Date().toISOString(),
              user: activeInstanceName,
              name: activeInstanceName,
              database,
              hostId,
              isOnController,
              sessionKind,
              deviceLabel: device?.label || null,
            })
          );
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [
    activeInstanceName,
    database,
    device?.label,
    firebaseDb,
    hostId,
    isOnController,
    isSharedDataReady,
    loginState,
    sessionKind,
  ]);

  // Function to set up Firebase listeners
  const setupFirebaseListeners = useCallback(() => {
    if (!firebaseDb || !isSharedDataReady) return;

    if (onValueRef.current) {
      const keys = Object.keys(onValueRef.current);
      for (const key of keys) {
        const _key = key as keyof typeof onValueRef.current; // Define type
        // unsubscribe from any previous listeners
        onValueRef.current[_key]?.();

        const updateRef = ref(
          firebaseDb,
          getChurchDataPath(churchId, "presentation", key)
        );

        onValueRef.current[_key] = onValue(updateRef, (snapshot) => {
          if (!snapshot.exists()) return;
          const data = snapshot.val();
          updateFromRemote({ [key]: data });
        });
      }
    }
  }, [churchId, firebaseDb, isSharedDataReady, updateFromRemote]);

  // Function to set up storage listener
  const setupStorageListener = useCallback(() => {
    // Clean up previous listener if it exists
    if (storageListenerCleanupRef.current) {
      storageListenerCleanupRef.current();
    }

    const handleStorage = ({ key, newValue }: StorageEvent) => {
      const onValueKeys = Object.keys(onValueRef.current);
      if (newValue && onValueKeys.some((e) => e === key)) {
        const value = JSON.parse(newValue);
        updateFromRemote({ [key as keyof typeof onValueRef.current]: value });
      }
    };

    window.addEventListener("storage", handleStorage);
    const cleanup = () => {
      window.removeEventListener("storage", handleStorage);
    };
    storageListenerCleanupRef.current = cleanup;
    return cleanup;
  }, [updateFromRemote]);

  // Function to refresh both listeners (exposed in context)
  const refreshPresentationListeners = useCallback(() => {
    setupFirebaseListeners();
    setupStorageListener();
  }, [setupFirebaseListeners, setupStorageListener]);

  // get updates from firebase - realtime changes from others
  useEffect(() => {
    refreshPresentationListeners();
  }, [refreshPresentationListeners]);

  useEffect(() => {
    if (loginState !== "success" || !churchId) {
      setChurchBranding(emptyChurchBranding());
      setChurchBrandingStatus("ready");
      return;
    }

    if (!firebaseDb || !isSharedDataReady) {
      setChurchBrandingStatus("loading");
      return;
    }

    setChurchBrandingStatus("loading");
    const brandingRef = ref(firebaseDb, getChurchDataPath(churchId, "branding"));
    const unsubscribe = onValue(
      brandingRef,
      (snapshot) => {
        setChurchBranding(
          snapshot.exists()
            ? normalizeChurchBranding(snapshot.val())
            : emptyChurchBranding()
        );
        setChurchBrandingStatus("ready");
      },
      (error) => {
        console.error("Could not subscribe to church branding:", error);
        setChurchBranding(emptyChurchBranding());
        setChurchBrandingStatus("ready");
      }
    );

    return () => {
      unsubscribe();
    };
  }, [churchId, firebaseDb, isSharedDataReady, loginState]);

  // Handle navigation away from the app - set up once when component mounts
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (instanceRef.current) {
        void settleFirebaseWrite(set(instanceRef.current, null));
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []); // Empty dependency array means this only runs once on mount

  const login = useCallback(async ({
    method,
    email,
    password,
  }: {
    method: HumanAuthMethod;
    email?: string;
    password?: string;
  }) => {
    if (authServerStatus !== "online") {
      setAuthError(
        authServerStatus === "checking"
          ? "Connecting to WorshipSync..."
          : "Could not reach the server. Check the connection and try again."
      );
      setLoginState("idle");
      return {};
    }

    setLoginState("loading");
    setAuthError("");

    try {
      const authResult = await authenticateHumanWithFirebase({
        method,
        email,
        password,
      });
      if (authResult.status !== "success") {
        setLoginState("error");
        return {};
      }
      const idToken = await authResult.user.getIdToken(true);
      const response = await createHumanSession({
        idToken,
        deviceId: getOrCreateDeviceId(),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        deviceLabel: getTrustedDeviceLabel(),
        requestNewCode: true,
      });

      if (response.bootstrap) {
        setPendingEmailVerificationId(null);
        setLastSignInMethod(method);
        dispatch({ type: "RESET" });
        applyBootstrap(response.bootstrap);
        setAuthServerStatus("online");
        navigate(getHumanPostAuthPath(location));
        return {};
      }

      if (response.requiresEmailCode && response.pendingAuthId) {
        setLoginState("idle");
        return {
          requiresEmailCode: true,
          pendingAuthId: response.pendingAuthId,
        };
      }

      setLoginState("error");
      setAuthError(SIGN_IN_UNEXPECTED_RESPONSE);
      return {};
    } catch (e) {
      console.error("Sign-in error:", e);
      if (isReachabilityError(e)) {
        setAuthServerStatus("offline");
        setAuthError("Could not reach the server. Check the connection and try again.");
        setLoginState("idle");
        return {};
      }
      const errorCode =
        typeof e === "object" &&
          e &&
          "code" in e &&
          typeof (e as { code?: unknown }).code === "string"
          ? ((e as { code: string }).code || "")
          : "";
      if (
        method !== "password" &&
        (errorCode === "auth/popup-blocked" ||
          errorCode === "auth/popup-closed-by-user")
      ) {
        setAuthError(
          "Provider sign-in did not complete. Try again, or use email and password."
        );
      } else if (
        method === "password" &&
        PASSWORD_SIGN_IN_FALLBACK_ERROR_CODES.has(errorCode)
      ) {
        setAuthError(
          "Could not sign in with email and password. If this account uses Google or Microsoft, continue with that method instead."
        );
      } else {
        setAuthError(getSignInFlowErrorMessage(e));
      }
      setLoginState("error");
      return {};
    }
  }, [
    authenticateHumanWithFirebase,
    applyBootstrap,
    authServerStatus,
    dispatch,
    isReachabilityError,
    location,
    navigate,
  ]);

  const verifyEmailCode = useCallback(async ({
    pendingAuthId,
    code,
  }: {
    pendingAuthId: string;
    code: string;
  }) => {
    if (authServerStatus !== "online") {
      setAuthError("Could not reach the server. Check the connection and try again.");
      setLoginState("idle");
      return false;
    }

    setLoginState("loading");
    setAuthError("");
    try {
      const response = await verifyEmailCodeRequest({
        pendingAuthId,
        code,
        deviceId: getOrCreateDeviceId(),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        deviceLabel: getTrustedDeviceLabel(),
      });
      setPendingEmailVerificationId(null);
      setLastSignInMethod("password");
      dispatch({ type: "RESET" });
      applyBootstrap(response.bootstrap);
      setAuthServerStatus("online");
      navigate(getHumanPostAuthPath(location));
      return true;
    } catch (error) {
      console.error("verifyEmailCode error:", error);
      if (isReachabilityError(error)) {
        setAuthServerStatus("offline");
        setAuthError("Could not reach the server. Check the connection and try again.");
        setLoginState("idle");
        return false;
      }
      setAuthError(getVerifyEmailCodeErrorMessage(error));
      setLoginState("error");
      return false;
    }
  }, [
    applyBootstrap,
    authServerStatus,
    dispatch,
    isReachabilityError,
    location,
    navigate,
  ]);

  const resendEmailCode = useCallback(
    async ({ pendingAuthId }: { pendingAuthId: string }) => {
      if (authServerStatus !== "online") {
        setAuthError(
          authServerStatus === "checking"
            ? "Connecting to WorshipSync..."
            : "Could not reach the server. Check the connection and try again."
        );
        return {};
      }

      setAuthError("");
      const auth = getHumanAuth();
      const user = auth.currentUser;
      if (!user) {
        setAuthError("Sign in again to continue.");
        return {};
      }

      try {
        const idToken = await user.getIdToken(true);
        const response = await resendEmailCodeRequest({
          idToken,
          pendingAuthId,
          deviceId: getOrCreateDeviceId(),
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          deviceLabel: getTrustedDeviceLabel(),
        });

        if (response.bootstrap) {
          setPendingEmailVerificationId(null);
          setLastSignInMethod("password");
          dispatch({ type: "RESET" });
          applyBootstrap(response.bootstrap);
          setAuthServerStatus("online");
          navigate(getHumanPostAuthPath(location));
          return {};
        }

        if (response.requiresEmailCode && response.pendingAuthId) {
          return { pendingAuthId: response.pendingAuthId };
        }

        setAuthError("Could not resend the code. Try again.");
        return {};
      } catch (error) {
        console.error("resendEmailCode error:", error);
        if (isReachabilityError(error)) {
          setAuthServerStatus("offline");
          setAuthError(
            "Could not reach the server. Check the connection and try again."
          );
          return {};
        }
        setAuthError(
          error instanceof AuthApiError
            ? error.message
            : "Could not resend the code. Try again."
        );
        return {};
      }
    },
    [
      applyBootstrap,
      authServerStatus,
      dispatch,
      isReachabilityError,
      location,
      navigate,
    ]
  );

  const createChurchAccountHandler = useCallback(async ({
    method,
    churchName,
    adminName,
    adminEmail,
    password,
  }: {
    method: HumanAuthMethod;
    churchName: string;
    adminName: string;
    adminEmail?: string;
    password?: string;
  }) => {
    setLoginState("loading");
    setAuthError("");
    let createdPasswordUser = false;
    const auth = getHumanAuth();
    try {
      const authResult =
        method === "password"
          ? {
            status: "success" as const,
            user: (
              await createUserWithEmailAndPassword(
                auth,
                String(adminEmail || "").trim(),
                String(password || ""),
              )
            ).user,
          }
          : await authenticateHumanWithFirebase({
            method,
            email: adminEmail,
            password,
          });
      if (authResult.status !== "success") {
        setLoginState("error");
        return {};
      }
      if (method === "password") {
        createdPasswordUser = true;
      }
      const idToken = await authResult.user.getIdToken(true);
      const response = await createChurchAccount({
        idToken,
        churchName,
        adminName,
        deviceId: getOrCreateDeviceId(),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        deviceLabel: getTrustedDeviceLabel(),
      });
      setLoginState("idle");
      return {
        requiresEmailCode: response.requiresEmailCode,
        pendingAuthId: response.pendingAuthId,
      };
    } catch (error) {
      if (createdPasswordUser && auth.currentUser) {
        await settleFirebaseWrite(auth.currentUser.delete());
        await signOutFirebaseAuth(auth);
      } else if (method !== "password") {
        await signOutFirebaseAuth(auth);
      }
      console.error("Create church error:", error);
      setAuthError(error instanceof Error ? error.message : "Could not create church");
      setLoginState("error");
      return {};
    }
  }, [authenticateHumanWithFirebase]);

  const forgotPassword = useCallback(async (email: string) => {
    if (authServerStatus !== "online") {
      setAuthError("Could not reach the server. Check the connection and try again.");
      throw new Error("Server unavailable");
    }

    setAuthError("");
    try {
      await forgotPasswordRequest(email);
    } catch (error) {
      if (isReachabilityError(error)) {
        setAuthServerStatus("offline");
      }
      setAuthError(getForgotPasswordErrorMessage(error));
      throw error;
    }
  }, [authServerStatus, isReachabilityError]);

  const updateSelfDisplayName = useCallback(async (displayName: string) => {
    const nextName = displayName.trim();
    if (!nextName) {
      setAuthError("Enter your name before saving.");
      return false;
    }
    try {
      await updateHumanProfile({ displayName: nextName });
      await refreshAuthBootstrap();
      return true;
    } catch (error) {
      setAuthError(
        error instanceof Error && error.message
          ? error.message
          : "Could not update your profile."
      );
      return false;
    }
  }, [refreshAuthBootstrap]);

  const setOperatorName = useCallback((value: string) => {
    setOperatorNameState(value);
    if (sessionKind === "workstation") {
      setWorkstationSessionOperatorName(value);
      clearLegacyWorkstationOperatorName();
      setUser(value);
      return;
    }
    setOperatorNameStorage(value);
  }, [sessionKind]);

  const endWorkstationOperatorSession = useCallback(async () => {
    if (sessionKind !== "workstation" || !device?.deviceId) {
      return;
    }
    const deviceId = device.deviceId;
    const token = getWorkstationToken();
    clearWorkstationSessionOperatorName();
    clearLegacyWorkstationOperatorName();
    setOperatorNameState("");
    const fallback = device.label?.trim() || "Operator";
    setUser(fallback);
    localStorage.setItem("user", fallback);
    globalFireDbInfo.user = fallback;
    navigate("/workstation/operator", { replace: true });
    try {
      await updateWorkstationOperator(deviceId, "", token);
    } catch (error) {
      console.error("Could not clear operator on server:", error);
    }
  }, [device, navigate, sessionKind]);

  const clearLocalSessionState = useCallback(async (nextPath: string) => {
    clearOperatorNameStorage();
    clearWorkstationSessionOperatorName();
    clearCsrfToken();
    if (sessionKind === "workstation") {
      clearWorkstationToken();
      // Same partition as projector/monitor/stream windows; do not leave a display token behind.
      clearDisplayToken();
    }
    if (sessionKind === "display") {
      clearDisplayToken();
    }
    await signOutFirebaseAuth(getSharedDataAuth());
    setPendingEmailVerificationId(null);
    clearPendingLinkState();
    setAccess("full");
    dispatch({ type: "RESET" });
    dispatch(ActionCreators.clearHistory());
    applyBootstrap(null);
    navigate(nextPath, { replace: true });
    setFirebaseDb(undefined);
    globalFireDbInfo.db = undefined;
  }, [applyBootstrap, clearPendingLinkState, dispatch, navigate, sessionKind]);

  const unlinkCurrentWorkstation = useCallback(async () => {
    if (sessionKind !== "workstation" || !device?.deviceId) {
      return;
    }
    const token = getWorkstationToken();
    await unlinkWorkstationRequest(device.deviceId, token);
    await signOutFirebaseAuth(getHumanAuth());
    await clearLocalSessionState("/");
  }, [clearLocalSessionState, device, sessionKind]);

  const logout = useCallback(async () => {
    try {
      await logoutSession();
      await signOutFirebaseAuth(getHumanAuth());
    } catch (error) {
      console.error("Sign-out error:", error);
    } finally {
      await clearLocalSessionState("/login");
    }
  }, [clearLocalSessionState]);

  const value = useMemo(
    () => ({
      loginState,
      bootstrapStatus,
      authServerStatus,
      authServerRetryCount,
      sessionKind,
      userId,
      user,
      userEmail,
      linkedAuthMethods,
      pendingLinkState,
      clearPendingLinkState,
      authenticateHumanWithFirebase,
      database,
      uploadPreset,
      login,
      verifyEmailCode,
      resendEmailCode,
      createChurchAccount: createChurchAccountHandler,
      forgotPassword,
      enterGuestMode,
      exitGuestMode,
      setLoginState,
      logout,
      unlinkCurrentWorkstation,
      endWorkstationOperatorSession,
      firebaseDb,
      hostId,
      activeInstances,
      access,
      churchId,
      churchName,
      churchStatus,
      recoveryEmail,
      churchBranding,
      churchBrandingStatus,
      role,
      authError,
      pendingEmailVerificationId,
      clearPendingEmailVerification,
      operatorName,
      device,
      setOperatorName,
      refreshAuthBootstrap,
      refreshPresentationListeners,
      updateSelfDisplayName,
    }),
    [
      loginState,
      bootstrapStatus,
      authServerStatus,
      authServerRetryCount,
      sessionKind,
      userId,
      user,
      userEmail,
      linkedAuthMethods,
      pendingLinkState,
      clearPendingLinkState,
      authenticateHumanWithFirebase,
      database,
      uploadPreset,
      login,
      verifyEmailCode,
      resendEmailCode,
      createChurchAccountHandler,
      forgotPassword,
      enterGuestMode,
      exitGuestMode,
      setLoginState,
      logout,
      unlinkCurrentWorkstation,
      endWorkstationOperatorSession,
      firebaseDb,
      hostId,
      activeInstances,
      access,
      churchId,
      churchName,
      churchStatus,
      recoveryEmail,
      churchBranding,
      churchBrandingStatus,
      role,
      authError,
      pendingEmailVerificationId,
      clearPendingEmailVerification,
      operatorName,
      device,
      setOperatorName,
      refreshAuthBootstrap,
      refreshPresentationListeners,
      updateSelfDisplayName,
    ]
  );

  return (
    <GlobalInfoContext.Provider value={value}>
      {children}
    </GlobalInfoContext.Provider>
  );
};

export default GlobalInfoProvider;
