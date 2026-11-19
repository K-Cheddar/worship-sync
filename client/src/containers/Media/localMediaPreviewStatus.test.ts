import { getLocalMediaPreviewStatus } from "./localMediaPreviewStatus";

describe("getLocalMediaPreviewStatus", () => {
  it.each(["image", "video"] as const)(
    "keeps the %s preview loading state distinct",
    (kind) => {
      expect(
        getLocalMediaPreviewStatus({
          kind,
          isLocal: true,
          isOwner: true,
          status: "loading",
          fileName: `missing.${kind === "image" ? "png" : "mp4"}`,
        }),
      ).toEqual({
        sourceLabel: `Local ${kind} · missing.${kind === "image" ? "png" : "mp4"}`,
        heading: `Loading local ${kind}`,
        state: "loading",
      });
    },
  );

  it("identifies an image owned by another device for both modal preview sizes", () => {
    const status = getLocalMediaPreviewStatus({
      kind: "image",
      isLocal: true,
      isOwner: false,
      status: "unavailable",
      fileName: "stage-background.png",
      ownerLabel: "Sanctuary PC",
    });

    expect(status).toEqual({
      sourceLabel: "Local image · stage-background.png",
      ownerLabel: "Sanctuary PC",
    });
  });

  it("gives the owner actionable relink guidance for a missing video", () => {
    expect(
      getLocalMediaPreviewStatus({
        kind: "video",
        isLocal: true,
        isOwner: true,
        status: "unavailable",
        mediaName: "Welcome video",
      }),
    ).toEqual({
      sourceLabel: "Local video · Welcome video",
      heading: "Local video unavailable",
      detail: "Open Media on this device and relink the file.",
    });
  });

  it("does not report an unavailable source when a playable fallback exists", () => {
    expect(
      getLocalMediaPreviewStatus({
        kind: "video",
        isLocal: true,
        isOwner: false,
        status: "ready",
        ownerLabel: "Sanctuary PC",
        previewUrl: "https://media.example/video.m3u8",
      }),
    ).toBeUndefined();
  });

  it("does not add local-source status for cloud-backed or ordinary media", () => {
    expect(
      getLocalMediaPreviewStatus({
        kind: "image",
        isLocal: false,
        isOwner: false,
        status: "not-local",
        previewUrl: "https://media.example/background.png",
      }),
    ).toBeUndefined();
  });
});
