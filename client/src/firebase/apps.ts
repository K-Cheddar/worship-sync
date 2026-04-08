import { FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import { Auth, getAuth } from "firebase/auth";
import { Database, getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const getNamedApp = (name: string): FirebaseApp => {
  const existing = getApps().find((app) => app.name === name);
  if (existing) {
    return existing;
  }
  return initializeApp(firebaseConfig, name);
};

export const getHumanAuthApp = () => getNamedApp("worshipsync-human-auth");
export const getHumanAuth = (): Auth => getAuth(getHumanAuthApp());

export const getSharedDataApp = () => getNamedApp("worshipsync-shared-data");
export const getSharedDataAuth = (): Auth => getAuth(getSharedDataApp());
export const getSharedDataDatabase = (): Database =>
  getDatabase(getSharedDataApp());

export const getDefaultFirebaseApp = (): FirebaseApp => {
  if (getApps().length > 0) {
    return getApp();
  }
  return initializeApp(firebaseConfig);
};
