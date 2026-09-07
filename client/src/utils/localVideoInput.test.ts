import {
  bindLocalVideoInput,
  buildLocalVideoInputPresentation,
  createLocalVideoInputMediaSource,
  getAudioInputErrorMessage,
  getLocalVideoSourceErrorMessage,
  getVideoInputErrorMessage,
  normalizeLocalVideoInput,
  normalizeLocalVideoInputMediaSource,
  registerLocalVideoInput,
  resolveLocalVideoInputBinding,
  resolveLocalVideoInputDeviceId,
} from "./localVideoInput";

describe("localVideoInput", () => {
  beforeEach(() => localStorage.clear());

  it("normalizes local capture metadata and rejects incomplete payloads", () => {
    expect(
      normalizeLocalVideoInput({
        sourceId: " source-1 ",
        deviceLabel: " USB Capture ",
        ownerDeviceId: " workstation-1 ",
        ownerLabel: " Booth ",
      }),
    ).toEqual({
      sourceId: "source-1",
      deviceLabel: "USB Capture",
      ownerDeviceId: "workstation-1",
      ownerLabel: "Booth",
    });
    expect(normalizeLocalVideoInput({ sourceId: "source-1" })).toBeUndefined();
    expect(normalizeLocalVideoInput(null)).toBeUndefined();
  });

  it("keeps hardware ids in a local binding instead of presentation metadata", () => {
    const binding = registerLocalVideoInput(
      "capture-1",
      "USB Capture",
      "capture-audio-1",
      "USB Capture Audio",
    );
    expect(binding).toEqual(
      expect.objectContaining({
        deviceId: "capture-1",
        deviceLabel: "USB Capture",
        audioDeviceId: "capture-audio-1",
        audioDeviceLabel: "USB Capture Audio",
      }),
    );
    expect(resolveLocalVideoInputDeviceId(binding?.sourceId ?? "")).toBe(
      "capture-1",
    );
    expect(resolveLocalVideoInputBinding(binding?.sourceId ?? "")).toEqual(
      binding,
    );
    expect(
      JSON.parse(
        localStorage.getItem("worshipsync_local_video_inputs") ?? "[]",
      ),
    ).toEqual([binding]);
  });

  it("returns an actionable message for common capture failures", () => {
    expect(
      getVideoInputErrorMessage(new DOMException("denied", "NotAllowedError")),
    ).toBe("Allow camera access on this device, then try again.");
    expect(
      getVideoInputErrorMessage(new DOMException("busy", "NotReadableError")),
    ).toBe("Close other apps using this input, then try again.");
    expect(
      getVideoInputErrorMessage(
        new DOMException("denied", "NotAllowedError"),
        true,
      ),
    ).toBe("Allow video and sound access on this device, then try again.");
    expect(
      getAudioInputErrorMessage(
        new DOMException("busy", "NotReadableError"),
      ),
    ).toBe("Close other apps using the audio input, then try again.");
  });

  it("saves a logical slide source while binding hardware per workstation", () => {
    const source = createLocalVideoInputMediaSource("Main camera");
    expect(source).toEqual(
      expect.objectContaining({
        kind: "local-video-input",
        label: "Main camera",
        fit: "contain",
        audioEnabled: true,
      }),
    );
    expect(source.sourceId).not.toContain("capture-card-1");

    expect(
      bindLocalVideoInput(
        source.sourceId,
        "capture-card-1",
        "USB Capture",
        "capture-audio-1",
        "USB Audio",
      ),
    ).toEqual(
      expect.objectContaining({
        sourceId: source.sourceId,
        deviceId: "capture-card-1",
      }),
    );
    expect(
      buildLocalVideoInputPresentation(source, "workstation-1", "Booth"),
    ).toEqual({
      sourceId: source.sourceId,
      deviceLabel: "USB Capture",
      ownerDeviceId: "workstation-1",
      ownerLabel: "Booth",
      fit: "contain",
      audioEnabled: true,
    });
    expect(normalizeLocalVideoInputMediaSource(source)).toEqual(source);
  });

  it("saves a screen share with the capture kind every surface reads", () => {
    const source = createLocalVideoInputMediaSource("Lyrics screen", "screen");
    expect(source).toEqual(
      expect.objectContaining({ label: "Lyrics screen", captureKind: "screen" }),
    );

    bindLocalVideoInput(
      source.sourceId,
      "screen:0:0",
      "Screen 1",
      undefined,
      undefined,
      {
        captureKind: "screen",
        displaySourceName: "Screen 1",
        systemAudio: true,
      },
    );

    expect(resolveLocalVideoInputBinding(source.sourceId)).toEqual(
      expect.objectContaining({
        deviceId: "screen:0:0",
        captureKind: "screen",
        displaySourceName: "Screen 1",
        systemAudio: true,
      }),
    );
    expect(
      buildLocalVideoInputPresentation(source, "workstation-1", "Booth"),
    ).toEqual({
      sourceId: source.sourceId,
      // A share keeps its operator-given name rather than the raw window title.
      deviceLabel: "Lyrics screen",
      ownerDeviceId: "workstation-1",
      ownerLabel: "Booth",
      captureKind: "screen",
      fit: "contain",
      audioEnabled: true,
    });
  });

  it("treats sources saved before screen capture as hardware inputs", () => {
    expect(
      normalizeLocalVideoInputMediaSource({
        kind: "local-video-input",
        sourceId: "source-1",
        label: "USB Capture",
      }),
    ).toEqual({
      kind: "local-video-input",
      sourceId: "source-1",
      label: "USB Capture",
    });
    expect(
      normalizeLocalVideoInputMediaSource({
        kind: "local-video-input",
        sourceId: "source-1",
        label: "Stage window",
        captureKind: "window",
      })?.captureKind,
    ).toBe("window");
    expect(
      normalizeLocalVideoInput({
        sourceId: "source-1",
        ownerDeviceId: "workstation-1",
        captureKind: "nonsense",
      })?.captureKind,
    ).toBeUndefined();
  });

  it("guides an operator differently for shares and cables", () => {
    expect(
      getLocalVideoSourceErrorMessage(
        new DOMException("denied", "NotAllowedError"),
        "screen",
      ),
    ).toBe(
      "Allow screen recording for WorshipSync on this computer, then share the screen again.",
    );
    expect(
      getLocalVideoSourceErrorMessage(
        Object.assign(new Error("stopped"), {
          name: "DesktopCaptureShareEndedError",
        }),
        "window",
      ),
    ).toBe(
      "Sharing stopped. Open Media on this computer and share the window again.",
    );
    expect(
      getLocalVideoSourceErrorMessage(
        new DOMException("busy", "NotReadableError"),
        "device",
      ),
    ).toBe("Close other apps using this input, then try again.");
  });

  it("relinks a logical input without changing its saved source id", () => {
    const source = createLocalVideoInputMediaSource("Main camera");
    bindLocalVideoInput(source.sourceId, "capture-1", "First capture");
    bindLocalVideoInput(source.sourceId, "capture-2", "Replacement capture");

    expect(resolveLocalVideoInputBinding(source.sourceId)).toEqual(
      expect.objectContaining({
        sourceId: source.sourceId,
        deviceId: "capture-2",
        deviceLabel: "Replacement capture",
      }),
    );
    expect(source.label).toBe("Main camera");
  });
});
