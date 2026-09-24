import {
  createServicePlanLinkResource,
  createServicePlanGenericResource,
  createServicePlanChurchResourceReference,
  createServicePlanDocumentResource,
  createServicePlanCustomDocumentReference,
  getEffectiveServicePlanResourceDefinition,
  getServicePlanCustomDocumentDisplayLabel,
  getServicePlanChurchResourceId,
  getServicePlanResourceDisplayLabel,
  isServicePlanChurchResourceReference,
  normalizeServicePlanResourceForPreview,
} from "./servicePlanResources";
import { getServicePlanElementContentResources } from "../../types/servicePlan";
import { plainTextToRichText } from "../../types/richText";

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

  it("does not let placeholder titles hide a URL-derived preview filename", () => {
    const resource = createServicePlanLinkResource({
      title: "Untitled resource",
      url: "https://www.dropbox.com/scl/fi/example/clip.mp4?dl=0",
    });

    expect(getServicePlanResourceDisplayLabel(resource)).toBe(resource.url);
    expect(normalizeServicePlanResourceForPreview(resource).title).toBeUndefined();
  });

  it("creates a generic resource without requiring a URL", () => {
    expect(
      createServicePlanGenericResource({
        title: "Offering instructions",
        notes: plainTextToRichText("Mention the online giving option."),
        url: "",
      }),
    ).toMatchObject({
      type: "generic",
      title: "Offering instructions",
      data: { notes: plainTextToRichText("Mention the online giving option.") },
    });
  });

  it("persists only a stable ChurchResource reference", () => {
    const reference = createServicePlanChurchResourceReference({ resourceId: "churchResource_1" });
    expect(reference).toEqual(
      expect.objectContaining({
        type: "document",
        data: { resourceId: "churchResource_1" },
      }),
    );
    expect(reference).not.toHaveProperty("url");
    expect(createServicePlanDocumentResource({ resourceId: "churchResource_1" })).toMatchObject({
      data: { resourceId: "churchResource_1" },
    });
    expect(getServicePlanChurchResourceId(reference)).toBe("churchResource_1");
    expect(isServicePlanChurchResourceReference(reference)).toBe(true);
    expect(getEffectiveServicePlanResourceDefinition(reference).label).toBe("File");
    expect(
      getEffectiveServicePlanResourceDefinition(reference, { kind: "audio" } as never).label,
    ).toBe("Audio");
  });

  it("persists custom documents by stable id and resolves their current title", () => {
    const reference = createServicePlanCustomDocumentReference({
      documentId: "free-document-1",
      title: "  Service Notes  ",
    });
    expect(reference).toMatchObject({
      type: "custom-document",
      title: "Service Notes",
      data: { customDocumentId: "free-document-1" },
    });
    expect(reference).not.toHaveProperty("slides");
    expect(getServicePlanCustomDocumentDisplayLabel(reference, {
      _id: "free-document-1",
      name: "Updated Service Notes",
    })).toBe("Updated Service Notes");
    expect(getServicePlanCustomDocumentDisplayLabel(reference)).toBe("Service Notes");
    expect(getEffectiveServicePlanResourceDefinition(reference).label).toBe("Custom document");
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

  it("prefers legacy song and scripture fields once when matching resources also exist", () => {
    const resources = getServicePlanElementContentResources({
      songRef: { kind: "library", songId: "song-1", songName: "Welcome Song" },
      scriptureRef: {
        label: "John 3:16 (NIV)",
        book: "John",
        chapter: "3",
        verseRange: "16",
        version: "NIV",
      },
      resources: [
        { id: "song-1", type: "song", title: "Welcome Song", data: { songId: "song-1" } },
        { id: "scripture-1", type: "scripture", title: "John 3:16", data: { label: "John 3:16 (NIV)" } },
        { id: "youtube-1", type: "youtube", title: "Sermon video" },
      ],
    });

    expect(resources.map(({ type, title }) => [type, title])).toEqual([
      ["song", "Welcome Song"],
      ["scripture", "John 3:16 (NIV)"],
      ["youtube", "Sermon video"],
    ]);
  });
});
