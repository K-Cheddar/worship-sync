import { Database } from "firebase/database";
import { Cloudinary } from "@cloudinary/url-gen";
import type PouchDB from "pouchdb-browser";

/** Mock EventTarget for testing (broadcast, updater, etc.) */
export class MockEventTarget implements EventTarget {
  private listeners: { [key: string]: EventListener[] } = {};

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
  }

  dispatchEvent(event: Event): boolean {
    (this.listeners[event.type] ?? []).forEach((l) => l(event));
    return true;
  }
}

/** Default PouchDB-shaped mock; override get/put as needed */
export function createMockPouchDB(
  overrides: Partial<Record<string, unknown>> = {},
): PouchDB.Database {
  return {
    get: jest.fn().mockResolvedValue({ _id: "credits", list: [] }),
    put: jest.fn(),
    find: jest.fn(),
    createIndex: jest.fn(),
    getIndexes: jest.fn(),
    deleteIndex: jest.fn(),
    ...overrides,
  } as unknown as PouchDB.Database;
}

/** Default Firebase Database-shaped mock */
export const mockFirebaseDb = {
  app: { name: "test" },
  type: "database",
  ref: jest.fn(),
  onValue: jest.fn(),
} as unknown as Database;

/** ControllerInfoContext value for tests */
export function createMockControllerContext(
  overrides: {
    db?: PouchDB.Database;
    dbProgress?: number;
    [key: string]: unknown;
  } = {},
) {
  const { db: overrideDb, ...rest } = overrides;
  return {
    db: overrideDb ?? createMockPouchDB(),
    dbProgress: 100,
    setIsMobile: jest.fn(),
    updater: new MockEventTarget(),
    bibleDb: undefined,
    cloud: new Cloudinary({ cloud: { cloudName: "test" } }),
    isMobile: false,
    isPhone: false,
    bibleDbProgress: 100,
    setIsPhone: jest.fn(),
    logout: jest.fn(),
    login: jest.fn(),
    connectionStatus: { status: "connected" as const, retryCount: 0 },
    pullFromRemote: jest.fn(),
    ...rest,
  };
}

/** GlobalInfoContext value for tests */
export function createMockGlobalContext(
  overrides: Record<string, unknown> = {},
) {
  return {
    user: "test-user",
    firebaseDb: mockFirebaseDb,
    login: jest.fn(),
    logout: jest.fn(),
    loginState: "success" as const,
    database: "test",
    setDatabase: jest.fn(),
    setUser: jest.fn(),
    uploadPreset: "",
    setLoginState: jest.fn(),
    hostId: "test-host",
    activeInstances: [],
    access: "full" as const,
    refreshPresentationListeners: jest.fn(),
    ...overrides,
  };
}

/** GlobalInfoContext value for Credits page (uses database for paths) */
export function createMockGlobalInfo(overrides: Record<string, unknown> = {}) {
  return {
    user: "testUser",
    firebaseDb: mockFirebaseDb,
    login: jest.fn(),
    logout: jest.fn(),
    loginState: "success" as const,
    database: "test-database",
    uploadPreset: "test-preset",
    setLoginState: jest.fn(),
    hostId: "test-host",
    activeInstances: [],
    access: "full" as const,
    refreshPresentationListeners: jest.fn(),
    setUser: jest.fn(),
    setDatabase: jest.fn(),
    ...overrides,
  };
}

/** ResizeObserver mock for jsdom */
export const mockResizeObserver = {
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
};

/** IntersectionObserver mock for jsdom */
export class MockIntersectionObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
}
