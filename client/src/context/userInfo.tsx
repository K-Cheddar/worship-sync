import { createContext, useEffect, useState } from "react";
import { UserInfoType } from "../types";

export const UserInfoContext = createContext<UserInfoType | null>(null);

const UserInfoProvider = ({ children }: any) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState("Demo");
  const [database, setDatabase] = useState("demo");
  const [uploadPreset, setUploadPreset] = useState("bpqu4ma5");

  useEffect(() => {
    localStorage.setItem("presentation", "null");
    let _isLoggedIn = localStorage.getItem("loggedIn") === "true";
    setIsLoggedIn(_isLoggedIn);
    let _user = localStorage.getItem("user");
    if (_user !== null && _user !== "null") {
      setUser(_user);
    }
    let _database = localStorage.getItem("database");
    if (_database !== null && _database !== "null") {
      setDatabase(_database);
    }
    let _uploadPreset = localStorage.getItem("upload_preset");
    if (_uploadPreset !== null && _uploadPreset !== "null") {
      setUploadPreset(_uploadPreset);
    }
  }, []);

  return (
    <UserInfoContext.Provider
      value={{ isLoggedIn, user, database, uploadPreset }}
    >
      {children}
    </UserInfoContext.Provider>
  );
};

export default UserInfoProvider;
