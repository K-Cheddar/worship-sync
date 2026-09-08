import type { LocalVideoInputMediaSource } from "../types";
import {
  buildLocalVideoInputSendPresentation,
  isLocalVideoInputMedia,
  mediaHasSendableContent,
} from "./localVideoMediaLibrary";

jest.mock("./authStorage", () => ({
  getOrCreateDeviceId: () => "device-1",
}));

jest.mock("./deviceInfo", () => ({
  getTrustedDeviceLabel: () => "Booth PC",
}));

jest.mock("./localVideoInput", () => {
  const actual = jest.requireActual("./localVideoInput");
  return {
    ...actual,
    buildLocalVideoInputPresentation: jest.fn(
      (source: LocalVideoInputMediaSource) => ({
        sourceId: source.sourceId,
        deviceLabel: source.label,
        ownerDeviceId: "device-1",
        ownerLabel: "Booth PC",
        captureKind: source.captureKind,
      }),
    ),
    resolveLocalVideoInputBinding: jest.fn(() => ({
      sourceId: "local_video_1",
      deviceId: "screen:0",
      deviceLabel: "Screen 1",
      captureKind: "screen",
    })),
  };
});

const screenSource: LocalVideoInputMediaSource = {
  kind: "local-video-input",
  sourceId: "local_video_1",
  label: "Canva Present",
  captureKind: "screen",
};

describe("localVideoMediaLibrary", () => {
  it("detects local video input media", () => {
    expect(
      isLocalVideoInputMedia({
        localVideoInput: screenSource,
      }),
    ).toBe(true);
    expect(isLocalVideoInputMedia({ localVideoInput: undefined })).toBe(false);
    expect(
      mediaHasSendableContent({
        background: "",
        localVideoInput: screenSource,
      }),
    ).toBe(true);
    expect(
      mediaHasSendableContent({
        background: "https://example.com/a.png",
      }),
    ).toBe(true);
  });

  it("builds a presentation that sets localVideoInput for send", () => {
    const result = buildLocalVideoInputSendPresentation({
      source: screenSource,
      name: "Canva Present",
      outputIds: ["projector"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.presentation.type).toBe("local-video-input");
    expect(result.presentation.localVideoInput).toEqual(
      expect.objectContaining({
        sourceId: "local_video_1",
        ownerDeviceId: "device-1",
      }),
    );
    expect(result.presentation.slide?.mediaSource).toEqual(screenSource);
    expect(result.presentation.outputIds).toEqual(["projector"]);
  });
});
