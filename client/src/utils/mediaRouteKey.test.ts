import {
  MEDIA_ROUTE_KEYS,
  migrateLegacyMediaRouteFolders,
  getMediaRouteKey,
} from "./mediaRouteKey";

describe("MEDIA_ROUTE_KEYS", () => {
  it("lists stable route keys without duplicates", () => {
    expect(MEDIA_ROUTE_KEYS).toHaveLength(11);
    expect(new Set(MEDIA_ROUTE_KEYS).size).toBe(11);
  });
});

describe("getMediaRouteKey", () => {
  it("maps overlay-controller path and pageMode", () => {
    expect(getMediaRouteKey("/overlay-controller")).toBe("overlay-controller");
    expect(getMediaRouteKey("/controller/item/x/y", "overlayController")).toBe(
      "overlay-controller",
    );
  });

  it("maps controller item routes by item type", () => {
    expect(getMediaRouteKey("/controller/item/a/b", "default", "song")).toBe(
      "controller-item-song",
    );
    expect(getMediaRouteKey("/controller/item/a/b", "default", "free")).toBe(
      "controller-item-free",
    );
    expect(getMediaRouteKey("/controller/item/a/b", "default", "bible")).toBe(
      "controller-item-bible",
    );
    expect(getMediaRouteKey("/controller/item/a/b", "default", "timer")).toBe(
      "controller-item-timer",
    );
    expect(getMediaRouteKey("/controller/item/a/b", "default", "image")).toBe(
      "controller-item-image",
    );
    expect(getMediaRouteKey("/controller/item/a/b", "default", "heading")).toBe(
      "controller-item-heading",
    );
    expect(getMediaRouteKey("/controller/item/a/b")).toBe(
      "controller-item-unknown",
    );
  });

  it("maps settings tabs to controller-settings", () => {
    expect(getMediaRouteKey("/controller/overlays")).toBe(
      "controller-overlays",
    );
    expect(getMediaRouteKey("/controller/preferences")).toBe(
      "controller-settings",
    );
    expect(getMediaRouteKey("/controller/quick-links")).toBe(
      "controller-settings",
    );
    expect(getMediaRouteKey("/controller/monitor-settings")).toBe(
      "controller-settings",
    );
    expect(getMediaRouteKey("/controller/songs")).toBe("controller-default");
    expect(getMediaRouteKey("/controller")).toBe("controller-default");
  });
});

describe("migrateLegacyMediaRouteFolders", () => {
  it("fans out legacy controller-item into per-type keys", () => {
    expect(
      migrateLegacyMediaRouteFolders({
        "controller-item": "folder-a",
        "controller-default": "root",
      }),
    ).toEqual({
      "controller-item-song": "folder-a",
      "controller-item-free": "folder-a",
      "controller-item-bible": "folder-a",
      "controller-item-timer": "folder-a",
      "controller-item-image": "folder-a",
      "controller-item-heading": "folder-a",
      "controller-item-unknown": "folder-a",
      "controller-default": "root",
    });
  });

  it("does not overwrite existing per-type keys", () => {
    expect(
      migrateLegacyMediaRouteFolders({
        "controller-item": "legacy",
        "controller-item-song": "songs-folder",
      }),
    ).toMatchObject({
      "controller-item-song": "songs-folder",
      "controller-item-free": "legacy",
    });
  });

  it("no-ops when legacy key absent", () => {
    expect(
      migrateLegacyMediaRouteFolders({ "controller-item-song": "x" }),
    ).toEqual({ "controller-item-song": "x" });
  });

  it("merges legacy settings-tab keys into controller-settings", () => {
    expect(
      migrateLegacyMediaRouteFolders({
        "controller-preferences": "pref-folder",
        "controller-quick-links": "ql-folder",
      }),
    ).toEqual({ "controller-settings": "pref-folder" });
  });

  it("uses quick-links then monitor when preferences absent", () => {
    expect(
      migrateLegacyMediaRouteFolders({
        "controller-quick-links": "ql",
        "controller-monitor-settings": "mon",
      }),
    ).toEqual({ "controller-settings": "ql" });
  });

  it("does not overwrite controller-settings when merging legacy settings keys", () => {
    expect(
      migrateLegacyMediaRouteFolders({
        "controller-settings": "merged",
        "controller-monitor-settings": "old-mon",
      }),
    ).toEqual({ "controller-settings": "merged" });
  });
});
