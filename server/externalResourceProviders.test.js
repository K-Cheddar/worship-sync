import assert from "node:assert/strict";
import test from "node:test";
import { resolveExternalResourceProvider } from "./externalResourceProviders.js";

test("normalizes supported provider share-link variants", () => {
  const cases = [
    [
      "youtube",
      "https://youtu.be/dQw4w9WgXcQ?t=30",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "dQw4w9WgXcQ",
    ],
    [
      "dropbox",
      "https://www.dropbox.com/scl/fi/id/clip.mp4?dl=0",
      "https://www.dropbox.com/scl/fi/id/clip.mp4?raw=1",
    ],
    [
      "google-drive",
      "https://drive.google.com/file/d/drive-file/view",
      "https://drive.google.com/uc?export=download&id=drive-file",
      "drive-file",
    ],
    [
      "google-drive",
      "https://docs.google.com/document/d/document-id/edit",
      "https://docs.google.com/document/d/document-id/export?format=pdf",
    ],
    [
      "onedrive",
      "https://1drv.ms/u/s!file",
      "https://1drv.ms/u/s!file?download=1",
    ],
    [
      "sharepoint",
      "https://church.sharepoint.com/:b:/s/team/Efile?e=share-token&web=1",
      "https://church.sharepoint.com/:b:/s/team/Efile?e=share-token&web=1&download=1",
    ],
    [
      "box",
      "https://app.box.com/s/public-file",
      "https://app.box.com/s/public-file?download=1",
    ],
  ];

  for (const [provider, originalUrl, candidateUrl, mediaId] of cases) {
    const resolved = resolveExternalResourceProvider(originalUrl);
    assert.equal(resolved.provider, provider);
    assert.equal(resolved.candidateUrl, candidateUrl);
    if (mediaId) assert.equal(resolved.mediaId, mediaId);
  }
});

test("leaves unknown HTTPS resources for direct metadata detection", () => {
  const originalUrl = "https://cdn.example.test/download?id=clip";
  assert.deepEqual(resolveExternalResourceProvider(originalUrl), {
    provider: "direct",
    candidateUrl: originalUrl,
  });
});

test("marks native Google Workspace PDF exports for direct GET probing", () => {
  const cases = [
    ["https://docs.google.com/document/d/doc-id/edit", "https://docs.google.com/document/d/doc-id/export?format=pdf"],
    ["https://docs.google.com/spreadsheets/d/sheet-id/edit", "https://docs.google.com/spreadsheets/d/sheet-id/export?format=pdf"],
    ["https://docs.google.com/presentation/d/slides-id/edit", "https://docs.google.com/presentation/d/slides-id/export/pdf"],
  ];
  for (const [url, candidateUrl] of cases) {
    assert.deepEqual(resolveExternalResourceProvider(url), {
      provider: "google-drive",
      candidateUrl,
      probeWithGet: true,
      nativeGoogleDocument: true,
    });
  }
});

test("does not treat lookalike hostnames as supported providers", () => {
  const resolved = resolveExternalResourceProvider("https://not-sharepoint.com/file.mp4");
  assert.equal(resolved.provider, "direct");
});
