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
import { getDatabase, Database } from "firebase/database";
import PouchDB from "pouchdb";
import { Cloudinary } from "@cloudinary/url-gen";
import { DBLogin } from "../types";
import { useNavigate } from "react-router-dom";
import { useDispatch } from "../hooks";

type GlobalInfoContextType = {
  db: PouchDB.Database | undefined;
  cloud: Cloudinary;
  login: ({
    username,
    password,
  }: {
    username: string;
    password: string;
  }) => void;
  logout: () => void;
  loginState: "idle" | "loading" | "error" | "success";
  user: string;
  database: string;
  uploadPreset: string;
  setLoginState: (val: "idle" | "loading" | "error" | "success") => void;
  updater: EventTarget;
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

export let globalDb: PouchDB.Database | undefined = undefined;
export let globalFireDbInfo: globalFireBaseInfoType = {
  db: undefined,
  user: "Demo",
};

const GlobalInfoProvider = ({ children }: any) => {
  const [db, setDb] = useState<PouchDB.Database | undefined>(undefined);
  const [firebaseDb, setFirebaseDb] = useState<Database | undefined>();
  const [loginState, setLoginState] = useState<
    "idle" | "loading" | "error" | "success"
  >("idle");
  const [user, setUser] = useState("Demo");
  const [database, setDatabase] = useState("demo");
  const [uploadPreset, setUploadPreset] = useState("bpqu4ma5");
  const updater = useRef(new EventTarget());
  const syncRef = useRef<any>();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const cloud = useMemo(() => {
    return new Cloudinary({
      cloud: {
        cloudName: "portable-media",
        apiKey: process.env.REACT_APP_CLOUDINARY_KEY,
        apiSecret: process.env.REACT_APP_CLOUDINARY_SECRET,
      },
    });
  }, []);

  const setupDb = useCallback(async () => {
    console.log(database, loginState);
    let remoteURL =
      process.env.REACT_APP_DATABASE_STRING + "portable-media-" + database;
    const remoteDb = new PouchDB(remoteURL);
    const localDb = new PouchDB("portable-media");

    remoteDb.replicate
      .to(localDb, { retry: true })
      .on("complete", function (info) {
        setDb(localDb);
        globalDb = localDb;
        console.log("Replication completed");
        if (loginState === "success") {
          syncRef.current = localDb
            .sync(remoteDb, { retry: true, live: true })
            .on("change", (event) => {
              if (event.direction === "push") {
                console.log("updating from local");
              }
              if (event.direction === "pull") {
                console.log("updating from remote");
                updater.current.dispatchEvent(new Event("update"));
              }
            });
        }
      });
  }, [database, loginState]);

  useEffect(() => {
    if (loginState === "success" || loginState === "idle") {
      setupDb();
    }
  }, [loginState, setupDb]);

  useEffect(() => {
    console.log("setting from local storage");
    localStorage.setItem("presentation", "null");
    const _isLoggedIn = localStorage.getItem("loggedIn") === "true";
    setLoginState(_isLoggedIn ? "success" : "idle");
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

  useEffect(() => {
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
  }, []);

  const login = async ({
    username,
    password,
  }: {
    username: string;
    password: string;
  }) => {
    if (!db) return;

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
        await db?.destroy();
        setDb(undefined);
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

  const logout = async () => {
    setLoginState("loading");
    localStorage.setItem("loggedIn", "false");
    localStorage.setItem("user", "Demo");
    localStorage.setItem("database", "demo");
    localStorage.setItem("upload_preset", "bpqu4ma5");
    await syncRef.current?.cancel();
    dispatch({ type: "RESET" });
    setUser("Demo");
    globalFireDbInfo.user = "Demo";
    setDatabase("demo");
    setUploadPreset("bpqu4ma5");
    navigate("/");
    setLoginState("idle");
  };

  return (
    <GlobalInfoContext.Provider
      value={{
        db,
        cloud,
        loginState,
        user,
        database,
        uploadPreset,
        login,
        setLoginState,
        logout,
        updater: updater.current,
        firebaseDb,
      }}
    >
      {children}
    </GlobalInfoContext.Provider>
  );
};

export default GlobalInfoProvider;
