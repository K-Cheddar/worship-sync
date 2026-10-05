import {
  createServicePlanLinkResource,
  createServicePlanGenericResource,
  createServicePlanChurchResourceReference,
  createServicePlanDocumentResource,
  createServicePlanTextResource,
  createServicePlanCustomDocumentReference,
  getEffectiveServicePlanResourceDefinition,
  getServicePlanCustomDocumentDisplayLabel,
  getServicePlanChurchResourceId,
  getServicePlanResourceDisplayLabel,
  getImportedTextResourceTitle,
  isServicePlanChurchResourceReference,
  normalizeServicePlanResourceForPreview,
} from "./servicePlanResources";
import { getServicePlanElementContentResources } from "../../types/servicePlan";
import { plainTextToRichText } from "../../types/richText";

describe("service-plan content resources", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=30", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30"],
  ])("detects YouTube links: %s", (url, normalizedUrl) => {
    expect(createServicePlanLinkResource({ title: "Video", url })).toMatchObject({
      type: "youtube",
      provider: "youtube",
      mediaId: "dQw4w9WgXcQ",
      url: normalizedUrl,
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

  it("keeps the saved rich text document in the preview resource", () => {
    const document = {
      blocks: [{
        type: "paragraph" as const,
        spans: [{ text: "Important note", bold: true, italic: true }],
      }],
    };
    const resource = createServicePlanTextResource({ title: "Notes", text: document });

    expect(normalizeServicePlanResourceForPreview(resource).richTextContent).toEqual(document);
  });

  it("derives a concise imported text title and keeps the full rich text body", () => {
    expect(getImportedTextResourceTitle("Pathfinder Pledge")).toBe("Pathfinder Pledge");
    expect(getImportedTextResourceTitle("\nWalking With Jesus\nAdditional detail")).toBe("Walking With Jesus");

    const paragraph = "A meaningful imported paragraph that continues with more detail. ".repeat(3);
    const resource = createServicePlanTextResource({
      title: getImportedTextResourceTitle(paragraph),
      text: plainTextToRichText(paragraph),
    });
    expect(resource.title.length).toBeLessThanOrEqual(72);
    expect(resource.title.length).toBeLessThan(paragraph.length);
    expect(getServicePlanResourceDisplayLabel(resource)).toBe(resource.title);
    expect(resource.data?.text).toEqual(plainTextToRichText(paragraph));
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
    expect(getEffectiveServicePlanResourceDefinition(reference, { kind: "document" } as never).label).toBe("File");
    expect(getEffectiveServicePlanResourceDefinition(reference, { kind: "audio" } as never).label).toBe("Audio");
    expect(getEffectiveServicePlanResourceDefinition(reference, { kind: "image" } as never).label).toBe("Other");
    expect(getEffectiveServicePlanResourceDefinition(reference, { kind: "other" } as never).label).toBe("Other");
  });

  it.each([
    [{ kind: "document", sourceType: "external", external: { url: "https://docs.example.test/file", mediaType: "document" } }, "File"],
    [{ kind: "audio", sourceType: "external", external: { url: "https://media.example.test/file.mp3", mediaType: "audio" } }, "Audio"],
    [{ kind: "other", sourceType: "external", external: { url: "https://example.test/", mediaType: "web" } }, "Web link"],
    [{ kind: "other", sourceType: "external", external: { url: "https://media.example.test/file.mp4", mediaType: "video" } }, "Video"],
    [{ kind: "other", sourceType: "external", external: { url: "https://youtube.com/watch?v=abc", provider: "youtube", mediaType: "video" } }, "YouTube"],
    [{ kind: "other", sourceType: "external", external: { url: "https://media.example.test/image.png", mediaType: "image" } }, "Other"],
    [{ kind: "other", sourceType: "external", external: { url: "https://example.test/unknown", provider: "unsupported" } }, "Other"],
  ] as const)("maps referenced ChurchResource metadata to %s", (churchResource, label) => {
    const reference = createServicePlanChurchResourceReference({ resourceId: "churchResource_1" });
    expect(getEffectiveServicePlanResourceDefinition(reference, churchResource as never).label).toBe(label);
    expect(reference.data).toEqual({ resourceId: "churchResource_1" });
  });

  it("normalizes an external ChurchResource reference to the shared preview descriptor", () => {
    const churchResource = {
      id: "churchResource_external",
      churchId: "church-1",
      name: "Shared guide",
      kind: "document" as const,
      sourceType: "external" as const,
      external: {
        url: "https://docs.google.com/document/d/guide/edit",
        provider: "google-drive",
        mimeType: "application/pdf",
        fileName: "guide.pdf",
      },
      createdAt: "2026-09-21T00:00:00.000Z",
      createdBy: "user-1",
      updatedAt: "2026-09-21T00:00:00.000Z",
      updatedBy: "user-1",
    };
    const preview = normalizeServicePlanResourceForPreview(
      createServicePlanChurchResourceReference({ resourceId: churchResource.id }),
      { churchResource },
    );
    expect(preview).toMatchObject({
      title: "Shared guide",
      url: churchResource.external.url,
      provider: "google-drive",
      mimeType: "application/pdf",
      fileName: "guide.pdf",
    });
    expect(preview).not.toHaveProperty("resolveSource");
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
