import { bibleType } from "../types";

const DB_NAME = "bibleDatabase";
const DB_VERSION = 1;

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // request.onupgradeneeded = (event) => {
    //   const db = (event.target as IDBRequest).result;
    //   if (!db.objectStoreNames.contains(STORE_NAME)) {
    //     db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
    //   }
    // };

    request.onsuccess = (event) => resolve((event.target as IDBRequest).result);
    request.onerror = (event) => reject((event.target as IDBRequest).error);
  });
}

export function addData(db: IDBDatabase, data: bibleType, version: string) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([version], "readwrite");
    const store = transaction.objectStore(version);
    const request = store.add(data);

    request.onsuccess = () => resolve("success");
    request.onerror = (event) => reject((event.target as IDBRequest).error);
  });
}
export function getAllData(db: IDBDatabase, version: string) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([version], "readonly");
    const store = transaction.objectStore(version);
    const request = store.getAll();

    request.onsuccess = (event) => resolve((event.target as IDBRequest).result);
    request.onerror = (event) => reject((event.target as IDBRequest).error);
  });
}
