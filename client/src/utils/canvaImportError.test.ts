import { CanvaImportError, formatCanvaImportError } from "./canvaImportError";

test("hides raw Firestore precondition errors behind a safe import message", () => {
  const error = new Error(
    "9 FAILED_PRECONDITION: The query requires an index. https://console.firebase.google.com/project/example/firestore/indexes",
  );

  expect(formatCanvaImportError(error, "mp4")).toBe(
    "Video import couldn't start. Please try again.",
  );
  expect(formatCanvaImportError(error, "mp4")).not.toMatch(
    /FAILED_PRECONDITION|firebase\.google|index/i,
  );
});

test("keeps the useful message for a known storage quota error", () => {
  const error = new CanvaImportError(
    "This church has reached its 2 GB video storage limit.",
    { code: "CHURCH_STORAGE_QUOTA_EXCEEDED" },
  );

  expect(formatCanvaImportError(error, "mp4")).toBe(error.message);
});

test("formats known provider reconciliation and Canva rate limit errors safely", () => {
  expect(
    formatCanvaImportError(
      new CanvaImportError("internal detail", {
        code: "CHURCH_PROVIDER_STORAGE_NOT_RECONCILED",
      }),
      "mp4",
    ),
  ).toMatch(/reconciled/i);
  expect(
    formatCanvaImportError(
      new CanvaImportError("provider response", { status: 429 }),
      "mp4",
    ),
  ).toMatch(/temporarily limiting/i);
});
