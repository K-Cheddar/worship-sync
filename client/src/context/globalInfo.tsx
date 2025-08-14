import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getDatabase,
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
import { loginUser } from "../api/login";

import {
  BibleDisplayInfo,
  OverlayInfo,
  Presentation as PresentationType,
} from "../types";
import { ActionCreators } from "redux-undo";

type LoginStateType = "idle" | "loading" | "error" | "success" | "demo";

type GlobalInfoContextType = {
  login: ({
    username,
    password,
  }: {
    username: string;
    password: string;
  }) => void;
  logout: () => void;
  loginState: LoginStateType;
  user: string;
  database: string;
  uploadPreset: string;
  setLoginState: (val: LoginStateType) => void;
  firebaseDb: Database | undefined;
  hostId: string;
  activeInstances: Instance[];
};

export const GlobalInfoContext = createContext<GlobalInfoContextType | null>(
  null
);

const firebaseConfig = {
  apiKey: "AIzaSyD8JdTmUVvAhQjBYnt59dOUqucnWiRMyMk",
  authDomain: "portable-media.firebaseapp.com",
  databaseURL: "https://portable-media.firebaseio.com",
  projectId: "portable-media",
  storageBucket: "portable-media.appspot.com",
  messagingSenderId: "456418139697",
  appId: "1:456418139697:web:02dabb94557dbf1dc07f10",
};

type globalFireBaseInfoType = {
  db: Database | undefined;
  user: string;
};

export const globalFireDbInfo: globalFireBaseInfoType = {
  db: undefined,
  user: "Demo",
};

export let globalHostId: string = "";

const GlobalInfoProvider = ({ children }: any) => {
  const [firebaseDb, setFirebaseDb] = useState<Database | undefined>();
  const [loginState, setLoginState] = useState<LoginStateType>("idle");
  const [user, setUser] = useState("Demo");
  const [database, setDatabase] = useState("demo");
  const [uploadPreset, setUploadPreset] = useState("bpqu4ma5");
  const [hostId] = useState(() => {
    const id = generateRandomId();
    globalHostId = id;
    return id;
  });
  const [activeInstances, setActiveInstances] = useState<Instance[]>([]);
  const instanceRef = useRef<ReturnType<typeof ref> | null>(null);
  const location = useLocation();
  const isOnController = useMemo(() => {
    return location.pathname.startsWith("/controller");
  }, [location.pathname]);

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
    timerInfo: undefined,
  });

  const navigate = useNavigate();
  const dispatch = useDispatch();

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

        if (!info) continue; // nothing to update here.
        dispatch({ type: updateAction, payload: info });
      }
    },
    [dispatch]
  );

  // get info from local storage on startup
  useEffect(() => {
    localStorage.setItem("presentation", "null");
    const _isLoggedIn = localStorage.getItem("loggedIn") === "true";
    setLoginState(_isLoggedIn ? "success" : "demo");
    const _user = localStorage.getItem("user");
    if (_user !== null && _user !== "null") {
      setUser(_user);
      globalFireDbInfo.user = _user;
    }
    const _database = localStorage.getItem("database");
    if (_database !== null && _database !== "null") {
      setDatabase(_database);
    }
    const _uploadPreset = localStorage.getItem("upload_preset");
    if (_uploadPreset !== null && _uploadPreset !== "null") {
      setUploadPreset(_uploadPreset);
    }
  }, []);

  // initialize firebase
  useEffect(() => {
    if (loginState !== "success") return; // only initialize app for logged in users

    initializeApp(firebaseConfig);

    const _db = getDatabase();
    setFirebaseDb(_db);
    globalFireDbInfo.db = _db;

    const auth = getAuth();
    signInWithEmailAndPassword(
      auth,
      "eliathahsdatechteam@gmail.com",
      "TamTam7550"
    );
  }, [loginState]);

  // Monitor connection state and handle reconnection
  useEffect(() => {
    if (!firebaseDb || loginState !== "success") return;

    const connectedRef = ref(firebaseDb, ".info/connected");
    const unsubscribe = onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        // When we reconnect, re-establish the active instance if we're on the controller page
        if (isOnController && instanceRef.current) {
          set(instanceRef.current, {
            lastActive: new Date().toISOString(),
            user: user,
            database: database,
            hostId: hostId,
            isOnController,
          });
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [firebaseDb, loginState, isOnController, user, database, hostId]);

  // get updates from firebase - realtime changes from others
  useEffect(() => {
    if (!firebaseDb) return;

    if (onValueRef.current) {
      const keys = Object.keys(onValueRef.current);
      for (const key of keys) {
        const _key = key as keyof typeof onValueRef.current; // Define type
        // unsubscribe from any previous listeners
        onValueRef.current[_key]?.();

        const updateRef = ref(
          firebaseDb,
          "users/" + user + "/v2/presentation/" + key
        );

        onValueRef.current[_key] = onValue(updateRef, (snapshot) => {
          const data = snapshot.val();
          if (data) {
            updateFromRemote({ [key]: data });
          }
        });
      }
    }
  }, [firebaseDb, user, updateFromRemote]);

  useEffect(() => {
    window.addEventListener("storage", ({ key, newValue }) => {
      const onValueKeys = Object.keys(onValueRef.current);
      if (newValue && onValueKeys.some((e) => e === key)) {
        const value = JSON.parse(newValue);
        updateFromRemote({ [key as keyof typeof onValueRef.current]: value });
      }
    });
    // Disabling this because we only want this event listener to register once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track active instances
  useEffect(() => {
    if (!firebaseDb || loginState !== "success") return;

    const activeInstancesRef = ref(
      firebaseDb,
      "users/" + user + "/v2/activeInstances"
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
        staleInstances.forEach(([hostId]) => {
          const staleRef = ref(
            firebaseDb,
            `users/${user}/v2/activeInstances/${hostId}`
          );
          set(staleRef, null);
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
      `users/${user}/v2/activeInstances/${hostId}`
    );

    // Function to update the instance
    const updateInstance = () => {
      if (instanceRef.current) {
        set(instanceRef.current, {
          lastActive: new Date().toISOString(),
          user: user,
          database: database,
          hostId: hostId,
          isOnController,
        });
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
      if (instanceRef.current) {
        set(instanceRef.current, null);
      }
    };
  }, [firebaseDb, loginState, user, database, hostId, isOnController]);

  // Handle navigation away from the app - set up once when component mounts
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (instanceRef.current) {
        set(instanceRef.current, null);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []); // Empty dependency array means this only runs once on mount

  const login = async ({
    username,
    password,
  }: {
    username: string;
    password: string;
  }) => {
    setLoginState("loading");

    try {
      const { success, errorMessage, user } = await loginUser(
        username,
        password
      );

      if (!success) {
        console.error("Login failed:", errorMessage);
        setLoginState("error");
      } else if (user) {
        dispatch({ type: "RESET" });
        setLoginState("success");
        localStorage.setItem("loggedIn", "true");
        localStorage.setItem("user", user.username);
        localStorage.setItem("database", user.database);
        localStorage.setItem("upload_preset", user.upload_preset);
        setUser(user.username);
        globalFireDbInfo.user = user.username;
        setDatabase(user.database);
        setUploadPreset(user.upload_preset);
        navigate("/");
      } else {
        console.error("Login failed:", errorMessage);
        setLoginState("error");
      }
    } catch (e) {
      console.error("Login error:", e);
      setLoginState("error");
    }
  };

  const logout = () => {
    localStorage.setItem("loggedIn", "false");
    localStorage.setItem("user", "Demo");
    localStorage.setItem("database", "demo");
    localStorage.setItem("upload_preset", "bpqu4ma5");
    dispatch({ type: "RESET" });
    dispatch(ActionCreators.clearHistory());
    setUser("Demo");
    globalFireDbInfo.user = "Demo";
    setDatabase("demo");
    setUploadPreset("bpqu4ma5");
    navigate("/");
    setLoginState("demo");
    setFirebaseDb(undefined);
    globalFireDbInfo.db = undefined;
  };

  return (
    <GlobalInfoContext.Provider
      value={{
        loginState,
        user,
        database,
        uploadPreset,
        login,
        setLoginState,
        logout,
        firebaseDb,
        hostId,
        activeInstances,
      }}
    >
      {children}
    </GlobalInfoContext.Provider>
  );
};

export default GlobalInfoProvider;
