import {
  DISPLAY_SETTINGS_DEFAULTS,
  fromLegacyMonitorSettings,
  getApplicableSettingKeys,
  normalizeDisplaySettings,
  resolveDisplaySettings,
  resolveOutputDefaults,
  shouldSendNextSlideForOutput,
} from "./displaySettings";

describe("getApplicableSettingKeys", () => {
  it("gives stream only local-video audio controls", () => {
    expect(getApplicableSettingKeys("stream")).toEqual([
      "localVideoAudioEnabled",
      "localVideoVolume",
    ]);
  });

  it("gives next-slide only to monitor", () => {
    expect(getApplicableSettingKeys("monitor")).toContain("showNextSlide");
    expect(getApplicableSettingKeys("projector")).not.toContain(
      "showNextSlide",
    );
  });

  it("gives projector a background control but monitor one too", () => {
    expect(getApplicableSettingKeys("projector")).toContain("showBackground");
    expect(getApplicableSettingKeys("monitor")).toContain("showBackground");
  });

  it("gives pull surfaces the clock/timer band only", () => {
    expect(getApplicableSettingKeys("board")).toEqual([
      "showClock",
      "showTimer",
      "clockFontSize",
      "timerFontSize",
    ]);
  });
});

describe("normalizeDisplaySettings", () => {
  it("drops a setting the render profile does not understand", () => {
    expect(
      normalizeDisplaySettings({ showNextSlide: true }, "projector"),
    ).toBeUndefined();
    expect(
      normalizeDisplaySettings({ showBackground: false }, "stream"),
    ).toBeUndefined();
  });

  it("keeps settings the profile does understand", () => {
    expect(
      normalizeDisplaySettings(
        { showClock: false, showNextSlide: true },
        "monitor",
      ),
    ).toEqual({ showClock: false, showNextSlide: true });
  });

  it("clamps font sizes into a usable range", () => {
    expect(
      normalizeDisplaySettings({ clockFontSize: 5000 }, "monitor")
        ?.clockFontSize,
    ).toBe(200);
    expect(
      normalizeDisplaySettings({ clockFontSize: 0 }, "monitor")?.clockFontSize,
    ).toBe(10);
    expect(
      normalizeDisplaySettings({ clockFontSize: "nope" }, "monitor")
        ?.clockFontSize,
    ).toBe(DISPLAY_SETTINGS_DEFAULTS.clockFontSize);
  });

  it("normalizes local-video audio settings", () => {
    expect(
      normalizeDisplaySettings(
        { localVideoAudioEnabled: true, localVideoVolume: 150 },
        "stream",
      ),
    ).toEqual({ localVideoAudioEnabled: true, localVideoVolume: 100 });
    expect(
      normalizeDisplaySettings({ localVideoVolume: -10 }, "projector"),
    ).toEqual({ localVideoVolume: 0 });
  });

  it("returns undefined for empty or malformed input", () => {
    expect(normalizeDisplaySettings(null, "monitor")).toBeUndefined();
    expect(normalizeDisplaySettings({}, "monitor")).toBeUndefined();
    expect(normalizeDisplaySettings("nope", "monitor")).toBeUndefined();
  });
});

describe("resolveDisplaySettings", () => {
  it("falls back to shipped defaults with nothing configured", () => {
    expect(resolveDisplaySettings(undefined)).toEqual(
      DISPLAY_SETTINGS_DEFAULTS,
    );
  });

  it("uses the display default when the screen has no opinion", () => {
    expect(resolveDisplaySettings({ showClock: false }).showClock).toBe(false);
  });

  it("lets one screen differ from a display it shares with another", () => {
    const outputDefaults = { showClock: false };
    expect(resolveDisplaySettings(outputDefaults).showClock).toBe(false);
    expect(
      resolveDisplaySettings(outputDefaults, { showClock: true }).showClock,
    ).toBe(true);
  });

  it("merges per field rather than wholesale", () => {
    const resolved = resolveDisplaySettings(
      { showClock: false, clockFontSize: 40 },
      { showTimer: false },
    );
    expect(resolved.showClock).toBe(false);
    expect(resolved.clockFontSize).toBe(40);
    expect(resolved.showTimer).toBe(false);
  });

  it("treats an explicit false as an override, not as absent", () => {
    expect(
      resolveDisplaySettings({ showClock: true }, { showClock: false })
        .showClock,
    ).toBe(false);
  });

  it("takes isHeadless only from the screen, since it describes the window", () => {
    expect(
      resolveDisplaySettings({ isHeadless: true } as never).isHeadless,
    ).toBe(false);
    expect(
      resolveDisplaySettings(undefined, { isHeadless: true }).isHeadless,
    ).toBe(true);
  });
});

describe("shouldSendNextSlideForOutput", () => {
  it("uses the display default when no screens are registered", () => {
    expect(shouldSendNextSlideForOutput({ showNextSlide: true })).toBe(true);
    expect(shouldSendNextSlideForOutput(undefined)).toBe(false);
  });

  it("sends when any screen wants it, so no screen is starved", () => {
    expect(
      shouldSendNextSlideForOutput({ showNextSlide: false }, [
        { showNextSlide: false },
        { showNextSlide: true },
      ]),
    ).toBe(true);
  });

  it("does not send when every screen has opted out", () => {
    expect(
      shouldSendNextSlideForOutput({ showNextSlide: true }, [
        { showNextSlide: false },
        { showNextSlide: false },
      ]),
    ).toBe(false);
  });

  it("counts a screen that inherits an enabled default", () => {
    expect(shouldSendNextSlideForOutput({ showNextSlide: true }, [{}])).toBe(
      true,
    );
  });
});

describe("fromLegacyMonitorSettings", () => {
  it("migrates the church-wide settings onto the monitor display", () => {
    expect(
      fromLegacyMonitorSettings({
        showClock: false,
        showTimer: true,
        showNextSlide: true,
        clockFontSize: 60,
        timerFontSize: 80,
        // Carried by the legacy node but no longer a display setting: sending a
        // timer is what fills the band, so it must not migrate across.
        timerId: null,
      }),
    ).toEqual({
      showClock: false,
      showTimer: true,
      showNextSlide: true,
      clockFontSize: 60,
      timerFontSize: 80,
    });
  });

  it("returns undefined when there is nothing to migrate", () => {
    expect(fromLegacyMonitorSettings(null)).toBeUndefined();
  });
});

describe("profile defaults", () => {
  it("keeps monitor backgrounds off until an operator opts in", () => {
    // Monitors showed text on black before this was configurable. Inheriting
    // the shipped `true` would switch slide media on for every existing church
    // without anyone touching a control.
    expect(
      resolveDisplaySettings(undefined, undefined, "monitor").showBackground,
    ).toBe(false);
  });

  it("leaves projector backgrounds on, which is how they have always rendered", () => {
    expect(
      resolveDisplaySettings(undefined, undefined, "projector").showBackground,
    ).toBe(true);
  });

  it("lets a screen override the display's video sound and level", () => {
    expect(
      resolveDisplaySettings(
        { localVideoAudioEnabled: false, localVideoVolume: 80 },
        { localVideoAudioEnabled: true, localVideoVolume: 35 },
        "stream",
      ),
    ).toEqual(
      expect.objectContaining({
        localVideoAudioEnabled: true,
        localVideoVolume: 35,
      }),
    );
  });

  it("lets a monitor display opt in explicitly", () => {
    expect(
      resolveDisplaySettings({ showBackground: true }, undefined, "monitor")
        .showBackground,
    ).toBe(true);
  });

  it("lets one screen override the display's choice", () => {
    expect(
      resolveDisplaySettings(
        { showBackground: true },
        { showBackground: false },
        "monitor",
      ).showBackground,
    ).toBe(false);
  });
});

describe("legacy settings under a partly configured display", () => {
  const LEGACY = {
    showClock: false,
    showTimer: true,
    showNextSlide: true,
    clockFontSize: 90,
    timerFontSize: 40,
  };

  it("keeps untouched fields on the church's values", () => {
    // The operator flipped Background and nothing else.
    const defaults = resolveOutputDefaults({ showBackground: true }, LEGACY);
    const resolved = resolveDisplaySettings(defaults, undefined, "monitor");

    expect(resolved.showBackground).toBe(true);
    // These were never configured, so they must not jump to shipped defaults.
    expect(resolved.showClock).toBe(false);
    expect(resolved.clockFontSize).toBe(90);
    expect(resolved.showNextSlide).toBe(true);
  });

  it("lets the display's own value win where one exists", () => {
    const defaults = resolveOutputDefaults({ showClock: true }, LEGACY);

    expect(resolveDisplaySettings(defaults, undefined, "monitor").showClock).toBe(
      true,
    );
  });

  it("falls back to the display alone when the church has no legacy settings", () => {
    expect(resolveOutputDefaults({ showClock: true }, undefined)).toEqual({
      showClock: true,
    });
  });

  it("uses legacy alone for a display nobody has configured", () => {
    const resolved = resolveDisplaySettings(
      resolveOutputDefaults(undefined, LEGACY),
      undefined,
      "monitor",
    );

    expect(resolved.clockFontSize).toBe(90);
    expect(resolved.showTimer).toBe(true);
  });
});
