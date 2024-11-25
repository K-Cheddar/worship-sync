import { createContext, useEffect, useState } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import PouchDB from "pouchdb";
import { Cloudinary } from "@cloudinary/url-gen";
import { DBLogin, UserInfoType } from "../types";
import { useNavigate } from "react-router-dom";

type GlobalInfoContextType = UserInfoType & {
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

export let globalDb: PouchDB.Database | undefined = undefined;

const GlobalInfoProvider = ({ children }: any) => {
  const [db, setDb] = useState<PouchDB.Database | undefined>(undefined);
  const [loginState, setLoginState] = useState<
    "idle" | "loading" | "error" | "success"
  >("idle");
  const [user, setUser] = useState("Demo");
  const [database, setDatabase] = useState("demo");
  const [uploadPreset, setUploadPreset] = useState("bpqu4ma5");
  const navigate = useNavigate();

  const cloud = new Cloudinary({
    cloud: {
      cloudName: "portable-media",
      apiKey: process.env.REACT_APP_CLOUDINARY_KEY,
      apiSecret: process.env.REACT_APP_CLOUDINARY_SECRET,
    },
  });

  useEffect(() => {
    const setupDb = async () => {
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
        });
    };

    localStorage.setItem("presentation", "null");
    const _isLoggedIn = localStorage.getItem("loggedIn") === "true";
    setLoginState(_isLoggedIn ? "success" : "idle");
    const _user = localStorage.getItem("user");
    if (_user !== null && _user !== "null") {
      setUser(_user);
    }
    const _database = localStorage.getItem("database");
    if (_database !== null && _database !== "null") {
      setDatabase(_database);
    }
    const _uploadPreset = localStorage.getItem("upload_preset");
    if (_uploadPreset !== null && _uploadPreset !== "null") {
      setUploadPreset(_uploadPreset);
    }

    setupDb();
  }, [database]);

  useEffect(() => {
    initializeApp(firebaseConfig);
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
        setLoginState("success");
        localStorage.setItem("loggedIn", "true");
        localStorage.setItem("user", user.username);
        localStorage.setItem("database", user.database);
        localStorage.setItem("upload_preset", user.upload_preset);
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
    setLoginState("idle");
    setUser("Demo");
    setDatabase("demo");
    setUploadPreset("bpqu4ma5");
    navigate("/");
  };

  return (
    <GlobalInfoContext.Provider
      value={{
        db,
        cloud,
        isLoggedIn: loginState === "success",
        user,
        database,
        uploadPreset,
        login,
        logout,
      }}
    >
      {children}
    </GlobalInfoContext.Provider>
  );
};

export default GlobalInfoProvider;
