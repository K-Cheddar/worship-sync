import {
  getHomeNavigationCacheKey,
  normalizeHomeNavigationMetadata,
  readHomeNavigationMetadata,
  writeHomeNavigationMetadata,
} from "./homeNavigationCache";

const createStorage = () => {
  const entries = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => entries.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => entries.set(key, value)),
  };
};

const metadata = {
  churchId: "church-1",
  controllers: [
    { id: "presentation", name: "Text Master", icon: "presentation" as const, iconColor: "orange" as const, order: 0 },
    { id: "ctrl_lobby", name: "Lobby", icon: "monitor" as const, iconColor: "teal" as const, order: 2 },
  ],
  displays: [
    { id: "out_lobby", name: "Lobby Screen", type: "projector" as const, order: 3 },
  ],
};

describe("home navigation metadata cache", () => {
  it("writes and synchronously reads versioned presentation metadata for one church", () => {
    const storage = createStorage();
    expect(writeHomeNavigationMetadata(metadata, storage, 1000)).toBe(true);
    expect(readHomeNavigationMetadata("church-1", storage, 1001)).toEqual(metadata);
    expect(storage.setItem).toHaveBeenCalledWith(
      getHomeNavigationCacheKey("church-1"),
      expect.stringContaining('"version":1'),
    );
  });

  it("never returns metadata cached for another church", () => {
    const storage = createStorage();
    writeHomeNavigationMetadata(metadata, storage, 1000);
    expect(readHomeNavigationMetadata("church-2", storage, 1001)).toBeNull();
    expect(readHomeNavigationMetadata(null, storage, 1001)).toBeNull();
  });

  it("rejects unsupported, expired, and far-future records", () => {
    const base = { ...metadata, version: 1, updatedAt: 1_000 };
    expect(normalizeHomeNavigationMetadata({ ...base, version: 2 }, "church-1", 1001)).toBeNull();
    expect(normalizeHomeNavigationMetadata(base, "church-1", 1_000 + 31 * 24 * 60 * 60 * 1000)).toBeNull();
    expect(normalizeHomeNavigationMetadata({ ...base, updatedAt: 1_000_000 }, "church-1", 1000)).toBeNull();
  });

  it("filters unsafe ids and normalizes unknown icons and colors", () => {
    const normalized = normalizeHomeNavigationMetadata(
      {
        ...metadata,
        version: 1,
        updatedAt: 1000,
        controllers: [
          { id: "presentation", name: "Main", icon: "https://invalid.test/icon.svg", iconColor: "url(javascript:alert(1))", order: 0 },
          { id: "bad/id", name: "Invalid route", icon: "monitor", iconColor: "cyan", order: 1 },
        ],
      },
      "church-1",
      1001,
    );
    expect(normalized?.controllers).toEqual([
      { id: "presentation", name: "Main", icon: "presentation", iconColor: "orange", order: 0 },
    ]);
  });

  it("tolerates malformed JSON and unavailable storage", () => {
    const brokenJsonStorage = {
      getItem: jest.fn(() => "{"),
      setItem: jest.fn(),
    };
    const unavailableStorage = {
      getItem: jest.fn(() => { throw new Error("Storage unavailable"); }),
      setItem: jest.fn(() => { throw new Error("Storage unavailable"); }),
    };
    expect(readHomeNavigationMetadata("church-1", brokenJsonStorage)).toBeNull();
    expect(readHomeNavigationMetadata("church-1", unavailableStorage)).toBeNull();
    expect(writeHomeNavigationMetadata(metadata, unavailableStorage)).toBe(false);
  });
});
