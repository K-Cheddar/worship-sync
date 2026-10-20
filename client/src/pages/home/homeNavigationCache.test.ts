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

  it("round trips rich icon references and restores built-in presentation order", () => {
    const normalized = normalizeHomeNavigationMetadata(
      {
        ...metadata,
        version: 1,
        updatedAt: 1000,
        controllers: [
          { id: "ctrl_lobby", name: "Lobby", icon: "monitor", iconColor: "teal", order: 0 },
          { id: "overlay", name: "Graphics Lead", icon: "layers", iconColor: "purple", order: 1 },
          { id: "presentation", name: "Text Master", icon: "presentation", iconColor: "orange", order: 2,
            homeIcon: { source: "tabler", name: "device-desktop", color: "#12abef" } },
        ],
      },
      "church-1",
      1001,
    );

    expect(normalized?.controllers.map(({ id }) => id)).toEqual([
      "presentation",
      "overlay",
      "ctrl_lobby",
    ]);
    expect(normalized?.controllers[0].homeIcon).toEqual({
      source: "tabler",
      name: "device-desktop",
      color: "#12abef",
    });
  });

  it("round trips controller descriptions without rejecting older v1 entries", () => {
    const description = "Operate the room display.";
    const withDescription = {
      ...metadata,
      controllers: [
        { ...metadata.controllers[0], description },
        metadata.controllers[1],
      ],
    };
    const storage = createStorage();

    expect(writeHomeNavigationMetadata(withDescription, storage, 1000)).toBe(true);
    expect(readHomeNavigationMetadata("church-1", storage, 1001)).toEqual(withDescription);

    const legacy = normalizeHomeNavigationMetadata(
      { ...metadata, version: 1, updatedAt: 1000 },
      "church-1",
      1001,
    );
    expect(legacy?.controllers[0].description).toBeUndefined();
  });

  it("drops resolved defaults from older caches but preserves descriptions marked custom", () => {
    const legacyPresentationDescription = "Build and run the main presentation. Arrange service items, edit slides, and send output to projector, monitor, and stream.";
    const legacyOverlayDescription = "Manage overlays, service timers, credits, and lower thirds for the stream.";
    const legacyAuxiliaryDescription = "Drive this screen with its own outline and content, or mirror another display.";
    const normalized = normalizeHomeNavigationMetadata(
      {
        ...metadata,
        version: 1,
        updatedAt: 1000,
        controllers: [
          { ...metadata.controllers[0], description: legacyPresentationDescription },
          { id: "overlay", name: "Graphics", icon: "layers", iconColor: "purple", order: 1,
            description: legacyOverlayDescription, descriptionIsDefault: true },
          { ...metadata.controllers[1], description: legacyAuxiliaryDescription,
            descriptionIsDefault: false },
        ],
      },
      "church-1",
      1001,
    );

    expect(normalized?.controllers[0].description).toBeUndefined();
    expect(normalized?.controllers[1].description).toBeUndefined();
    expect(normalized?.controllers[2]).toMatchObject({ description: legacyAuxiliaryDescription });
    expect(normalized?.controllers[2]).not.toHaveProperty("descriptionIsDefault");
  });

  it("rewrites a legacy cache to remove resolved defaults while retaining its age", () => {
    const storage = createStorage();
    const key = getHomeNavigationCacheKey("church-1");
    storage.setItem(key, JSON.stringify({
      version: 1,
      updatedAt: 1000,
      ...metadata,
      controllers: [
        { ...metadata.controllers[0], description: "Build and run the main presentation. Arrange service items, edit slides, and send output to projector, monitor, and stream." },
      ],
    }));

    expect(readHomeNavigationMetadata("church-1", storage, 1001)?.controllers[0].description).toBeUndefined();
    const migrated = JSON.parse(storage.getItem(key) ?? "{}");
    expect(migrated.updatedAt).toBe(1000);
    expect(migrated.controllers[0]).not.toHaveProperty("description");
  });

  it("does not persist resolved defaults in newly written metadata", () => {
    const storage = createStorage();
    const metadataWithoutCustomDescriptions = {
      ...metadata,
      controllers: metadata.controllers.map(({ ...profile }) => profile),
    };

    expect(writeHomeNavigationMetadata(metadataWithoutCustomDescriptions, storage, 1000)).toBe(true);
    const stored = JSON.parse(storage.getItem(getHomeNavigationCacheKey("church-1")) ?? "{}");

    expect(stored.controllers.every((profile: { description?: string }) => !profile.description)).toBe(true);
    expect(stored.controllers.every((profile: { descriptionIsDefault?: boolean }) => profile.descriptionIsDefault === undefined)).toBe(true);
  });

  it("preserves a custom description even when it matches the old default", () => {
    const legacyDescription = "Build and run the main presentation. Arrange service items, edit slides, and send output to projector, monitor, and stream.";
    const normalized = normalizeHomeNavigationMetadata(
      {
        ...metadata,
        version: 1,
        updatedAt: 1000,
        controllers: [
          {
            ...metadata.controllers[0],
            description: legacyDescription,
            descriptionIsDefault: false,
          },
        ],
      },
      "church-1",
      1001,
    );

    expect(normalized?.controllers[0]).toMatchObject({ description: legacyDescription });
    expect(normalized?.controllers[0]).not.toHaveProperty("descriptionIsDefault");
  });

  it("normalizes and bounds cached controller descriptions", () => {
    const normalized = normalizeHomeNavigationMetadata(
      {
        ...metadata,
        version: 1,
        updatedAt: 1000,
        controllers: [
          { ...metadata.controllers[0], description: `  ${"x ".repeat(200)} ` },
        ],
      },
      "church-1",
      1001,
    );

    expect(normalized?.controllers[0].description).toHaveLength(280);
    expect(normalized?.controllers[0].description).not.toMatch(/\s{2}/);
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
