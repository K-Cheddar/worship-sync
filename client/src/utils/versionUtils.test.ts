import {
  isNewerVersion,
  isVersionUpdateDismissed,
  markVersionUpdateDismissed,
  getCachedChangelog,
  cacheChangelog,
} from "./versionUtils";

describe("isNewerVersion", () => {
  it("returns true when major version is higher", () => {
    expect(isNewerVersion("2.0.0", "1.0.0")).toBe(true);
  });

  it("returns false when major version is lower", () => {
    expect(isNewerVersion("1.0.0", "2.0.0")).toBe(false);
  });

  it("returns true when minor version is higher", () => {
    expect(isNewerVersion("1.5.0", "1.4.0")).toBe(true);
  });

  it("returns false when minor version is lower", () => {
    expect(isNewerVersion("1.4.0", "1.5.0")).toBe(false);
  });

  it("returns true when patch version is higher", () => {
    expect(isNewerVersion("1.0.2", "1.0.1")).toBe(true);
  });

  it("returns false for equal versions", () => {
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
  });

  it("treats missing segments as 0", () => {
    expect(isNewerVersion("1.0.1", "1.0")).toBe(true);
    expect(isNewerVersion("1.0", "1.0.1")).toBe(false);
    expect(isNewerVersion("2", "1.9.9")).toBe(true);
  });
});

describe("markVersionUpdateDismissed / isVersionUpdateDismissed", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns false when no dismissal is stored", () => {
    expect(isVersionUpdateDismissed("1.2.0")).toBe(false);
  });

  it("returns true immediately after dismissal for the same version", () => {
    jest.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    markVersionUpdateDismissed("1.2.0");
    expect(isVersionUpdateDismissed("1.2.0")).toBe(true);
  });

  it("returns false for a different version than was dismissed", () => {
    jest.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    markVersionUpdateDismissed("1.2.0");
    expect(isVersionUpdateDismissed("1.3.0")).toBe(false);
  });

  it("returns false after the 6-hour dismissal window has elapsed", () => {
    jest.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    markVersionUpdateDismissed("1.2.0");
    jest.advanceTimersByTime(6 * 60 * 60 * 1000 + 1);
    expect(isVersionUpdateDismissed("1.2.0")).toBe(false);
  });

  it("returns true just before the 6-hour window expires", () => {
    jest.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    markVersionUpdateDismissed("1.2.0");
    jest.advanceTimersByTime(6 * 60 * 60 * 1000 - 1);
    expect(isVersionUpdateDismissed("1.2.0")).toBe(true);
  });
});

describe("cacheChangelog / getCachedChangelog", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns null when cache is empty", () => {
    expect(getCachedChangelog("1.2.0")).toBeNull();
  });

  it("returns cached content for the same version within 24 hours", () => {
    jest.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    cacheChangelog("1.2.0", "# Changes\n- Fixed stuff");
    expect(getCachedChangelog("1.2.0")).toBe("# Changes\n- Fixed stuff");
  });

  it("returns null for a different version than was cached", () => {
    jest.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    cacheChangelog("1.2.0", "changelog content");
    expect(getCachedChangelog("1.3.0")).toBeNull();
  });

  it("returns null after the 24-hour cache window expires", () => {
    jest.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    cacheChangelog("1.2.0", "changelog content");
    jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(getCachedChangelog("1.2.0")).toBeNull();
  });

  it("returns content just before the 24-hour window expires", () => {
    jest.setSystemTime(new Date("2024-01-01T12:00:00Z"));
    cacheChangelog("1.2.0", "changelog content");
    jest.advanceTimersByTime(24 * 60 * 60 * 1000 - 1);
    expect(getCachedChangelog("1.2.0")).toBe("changelog content");
  });
});
