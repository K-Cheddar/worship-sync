import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getDatabase, Database } from "firebase/database";
import PouchDB from "pouchdb";
import { DBLogin } from "../types";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "../hooks";
import { globalDb } from "./controllerInfo";
import { ref, onValue, Unsubscribe } from "firebase/database";
import {
  updateMonitorFromRemote,
  updateProjectorFromRemote,
  updateStreamFromRemote,
  updateBibleDisplayInfoFromRemote,
  updateParticipantOverlayInfoFromRemote,
  updateStbOverlayInfoFromRemote,
} from "../store/presentationSlice";
import {
  BibleDisplayInfo,
  OverlayInfo,
  Presentation as PresentationType,
} from "../types";
import { UnknownAction } from "@reduxjs/toolkit";
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

export let globalFireDbInfo: globalFireBaseInfoType = {
  db: undefined,
  user: "Demo",
};

const GlobalInfoProvider = ({ children }: any) => {
  const { projectorInfo, monitorInfo, streamInfo } = useSelector(
    (state) => state.presentation
  );

  const [firebaseDb, setFirebaseDb] = useState<Database | undefined>();
  const [loginState, setLoginState] = useState<LoginStateType>("idle");
  const [user, setUser] = useState("Demo");
  const [database, setDatabase] = useState("demo");
  const [uploadPreset, setUploadPreset] = useState("bpqu4ma5");

  const onValueRef = useRef<{
    projectorInfo: Unsubscribe | undefined;
    monitorInfo: Unsubscribe | undefined;
    streamInfo: Unsubscribe | undefined;
    stream_bibleInfo: Unsubscribe | undefined;
    stream_participantOverlayInfo: Unsubscribe | undefined;
    stream_stbOverlayInfo: Unsubscribe | undefined;
  }>({
    projectorInfo: undefined,
    monitorInfo: undefined,
    streamInfo: undefined,
    stream_bibleInfo: undefined,
    stream_participantOverlayInfo: undefined,
    stream_stbOverlayInfo: undefined,
  });

  const navigate = useNavigate();
  const dispatch = useDispatch();

  const updateFromRemote = useCallback(
    (data: any) => {
      const _monitorInfo: PresentationType | undefined = data.monitorInfo;
      const _projectorInfo: PresentationType | undefined = data.projectorInfo;
      const _streamInfo: PresentationType | undefined = data.streamInfo;
      const _stream_bibleInfo: BibleDisplayInfo | undefined =
        data.stream_bibleInfo;
      const _stream_participantOverlayInfo: OverlayInfo | undefined =
        data.stream_participantOverlayInfo;
      const _stream_stbOverlayInfo: OverlayInfo | undefined =
        data.stream_stbOverlayInfo;

      type updateInfoChildType = {
        info: PresentationType | BibleDisplayInfo | OverlayInfo;
        updateFunction: (
          arg0: PresentationType | BibleDisplayInfo | OverlayInfo
        ) => UnknownAction;
        compareTo: PresentationType | BibleDisplayInfo | OverlayInfo;
      };

      const updateInfo = {
        projectorInfo: {
          info: _projectorInfo,
          updateFunction: updateProjectorFromRemote,
          compareTo: projectorInfo,
        },
        monitorInfo: {
          info: _monitorInfo,
          updateFunction: updateMonitorFromRemote,
          compareTo: monitorInfo,
        },
        streamInfo: {
          info: _streamInfo,
          updateFunction: updateStreamFromRemote,
          compareTo: streamInfo,
        },
        stream_bibleInfo: {
          info: _stream_bibleInfo,
          updateFunction: updateBibleDisplayInfoFromRemote,
          compareTo: streamInfo.bibleDisplayInfo,
        },
        stream_participantOverlayInfo: {
          info: _stream_participantOverlayInfo,
          updateFunction: updateParticipantOverlayInfoFromRemote,
          compareTo: streamInfo.participantOverlayInfo,
        },
        stream_stbOverlayInfo: {
          info: _stream_stbOverlayInfo,
          updateFunction: updateStbOverlayInfoFromRemote,
          compareTo: streamInfo.stbOverlayInfo,
        },
      };

      const keys = Object.keys(updateInfo);
      for (const key of keys) {
        const _key = key as keyof typeof updateInfo; // Define type
        const obj = updateInfo[_key];
        const { info, updateFunction, compareTo } = obj as updateInfoChildType;

        if (!info) continue; // nothing to update here.

        if (
          (info.time && compareTo?.time && info.time > compareTo.time) ||
          (info.time && !compareTo?.time)
        ) {
          dispatch(updateFunction({ ...info }));
        }
      }
    },
    [dispatch, monitorInfo, projectorInfo, streamInfo]
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
        // console.log("Storage update", key, value);
        updateFromRemote({ [key as keyof typeof onValueRef.current]: value });
      }
    });
    // Disabling this because we only want this event listener to register once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async ({
    username,
    password,
  }: {
    username: string;
    password: string;
  }) => {
    if (!globalDb) return;

    setLoginState("loading");

    try {
      const dbName =
        process.env.REACT_APP_DATABASE_STRING + "portable-media-logins";
      const loginDb = new PouchDB(dbName);
      const db_logins: DBLogin = await loginDb.get("logins");
      let user = db_logins.logins.find(
        (e) => e.username === username && e.password === password
      );
      if (!user) {
        setLoginState("error");
      } else {
        dispatch({ type: "RESET" });
        if (globalDb) {
          await globalDb.destroy();
        }
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
      }
    } catch (e) {
      console.error(e);
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
      }}
    >
      {children}
    </GlobalInfoContext.Provider>
  );
};

export default GlobalInfoProvider;
