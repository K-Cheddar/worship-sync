import {
  createServicePlanLinkResource,
  createServicePlanGenericResource,
  createServicePlanDocumentResource,
} from "./servicePlanResources";
import { getServicePlanElementContentResources } from "../../types/servicePlan";

describe("service-plan content resources", () => {
  it.each([
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=30",
  ])("detects YouTube links: %s", (url) => {
    expect(createServicePlanLinkResource({ title: "Video", url })).toMatchObject({
      type: "youtube",
      provider: "youtube",
      mediaId: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
  });

  it("keeps ordinary URLs as web links", () => {
    expect(
      createServicePlanLinkResource({
        title: "Slides",
        url: "https://docs.example.test/slides",
      }),
    ).toMatchObject({
      type: "url",
      title: "Slides",
      url: "https://docs.example.test/slides",
    });
  });

  it("creates a generic resource without requiring a URL", () => {
    expect(
      createServicePlanGenericResource({
        title: "Offering instructions",
        notes: "Mention the online giving option.",
        url: "",
      }),
    ).toMatchObject({
      type: "generic",
      title: "Offering instructions",
      data: { notes: "Mention the online giving option." },
    });
  });

  it("persists only a stable ChurchResource reference", () => {
    expect(createServicePlanDocumentResource({ resourceId: "churchResource_1" })).toEqual(
      expect.objectContaining({
        type: "document",
        data: { resourceId: "churchResource_1" },
      }),
    );
    expect(createServicePlanDocumentResource({ resourceId: "churchResource_1" })).not.toHaveProperty("url");
  });

  it("projects legacy song and scripture fields when resources is absent", () => {
    const resources = getServicePlanElementContentResources({
      songRef: { kind: "library", songId: "song-1", songName: "Welcome Song" },
      scriptureRef: {
        label: "John 3:16 (NIV)",
        book: "John",
        chapter: "3",
        verseRange: "16",
        version: "NIV",
      },
    });
    expect(resources.map((resource) => resource.type)).toEqual(["song", "scripture"]);
  });
});
