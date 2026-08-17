import {
  readScreenSettings,
  subscribeToScreenSettings,
  writeScreenSettings,
} from "./screenSettingsStore";

beforeEach(() => {
  window.localStorage.clear();
});

describe("screen setting overrides", () => {
  it("returns nothing for a screen that has never been configured", () => {
    expect(readScreenSettings("out_lobby")).toBeUndefined();
  });

  it("stores an override for one display without touching another", () => {
    writeScreenSettings("out_lobby", { showClock: true }, "projector");
    writeScreenSettings("projector", { showClock: false }, "projector");

    expect(readScreenSettings("out_lobby")?.showClock).toBe(true);
    expect(readScreenSettings("projector")?.showClock).toBe(false);
  });

  it("merges rather than replacing, so one toggle does not clear another", () => {
    writeScreenSettings("out_lobby", { showClock: true }, "projector");
    writeScreenSettings("out_lobby", { showTimer: false }, "projector");

    expect(readScreenSettings("out_lobby")).toEqual({
      showClock: true,
      showTimer: false,
    });
  });

  it("keeps isHeadless, which no render profile claims", () => {
    writeScreenSettings("out_lobby", { isHeadless: true }, "projector");
    expect(readScreenSettings("out_lobby")?.isHeadless).toBe(true);
  });

  it("drops a setting the render profile does not understand", () => {
    writeScreenSettings("out_web", { showBackground: false }, "stream");
    expect(readScreenSettings("out_web")).toBeUndefined();
  });

  it("clears overrides so the display's defaults apply again", () => {
    writeScreenSettings("out_lobby", { showClock: true }, "projector");
    writeScreenSettings("out_lobby", null);
    expect(readScreenSettings("out_lobby")).toBeUndefined();
  });

  it("survives unreadable local state rather than blocking the screen", () => {
    window.localStorage.setItem("worshipSync_screenDisplaySettings", "{oops");
    expect(readScreenSettings("out_lobby")).toBeUndefined();
  });
});

describe("change notification", () => {
  it("tells this document when a setting is written here", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToScreenSettings(listener);

    writeScreenSettings("out_lobby", { isHeadless: true });

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("tells this document when another window writes the same key", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToScreenSettings(listener);

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "worshipSync_screenDisplaySettings",
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("ignores unrelated keys so a display never re-renders for nothing", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToScreenSettings(listener);

    window.dispatchEvent(new StorageEvent("storage", { key: "somethingElse" }));

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = jest.fn();
    subscribeToScreenSettings(listener)();

    writeScreenSettings("out_lobby", { isHeadless: true });

    expect(listener).not.toHaveBeenCalled();
  });
});
