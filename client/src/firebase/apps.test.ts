import {
  getHumanAuth,
  getSharedDataAuth,
  getSharedDataDatabase,
} from "./apps";
import { inMemoryPersistence } from "firebase/auth";

const getAppsMock = jest.fn();
const initializeAppMock = jest.fn();
const getAppMock = jest.fn();
const getAuthMock = jest.fn();
const initializeAuthMock = jest.fn();
const getDatabaseMock = jest.fn();

jest.mock("firebase/app", () => ({
  getApp: (...args: unknown[]) => getAppMock(...args),
  getApps: (...args: unknown[]) => getAppsMock(...args),
  initializeApp: (...args: unknown[]) => initializeAppMock(...args),
}));

jest.mock("firebase/auth", () => ({
  getAuth: (...args: unknown[]) => getAuthMock(...args),
  inMemoryPersistence: { type: "NONE" },
  initializeAuth: (...args: unknown[]) => initializeAuthMock(...args),
}));

jest.mock("firebase/database", () => ({
  getDatabase: (...args: unknown[]) => getDatabaseMock(...args),
}));

describe("Firebase app isolation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getAppsMock.mockReturnValue([]);
    initializeAppMock.mockImplementation((_config, name) => ({ name }));
    getAuthMock.mockReturnValue({ name: "human-auth" });
    initializeAuthMock.mockReturnValue({ name: "shared-data-auth" });
    getDatabaseMock.mockReturnValue({ name: "shared-data-db" });
  });

  it("keeps human auth persistent while shared-data auth is renderer-local", () => {
    expect(getHumanAuth()).toEqual({ name: "human-auth" });
    expect(getAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "worshipsync-human-auth" }),
    );

    expect(getSharedDataAuth()).toEqual({ name: "shared-data-auth" });
    expect(initializeAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "worshipsync-shared-data" }),
      { persistence: inMemoryPersistence },
    );
  });

  it("uses the same shared-data app for Auth and Realtime Database", () => {
    getSharedDataAuth();
    expect(getSharedDataDatabase()).toEqual({ name: "shared-data-db" });

    expect(initializeAuthMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "worshipsync-shared-data" }),
      expect.anything(),
    );
    expect(getDatabaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "worshipsync-shared-data" }),
    );
  });
});
