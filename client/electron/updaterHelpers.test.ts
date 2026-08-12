import {
  isNewerVersion,
  shouldForwardUpdaterErrorToRenderer,
} from "./updaterHelpers";

describe("isNewerVersion", () => {
  it("detects a strictly newer dotted version", () => {
    expect(isNewerVersion("1.2.0", "1.1.9")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("1.2.1", "1.2.0")).toBe(true);
  });

  it("returns false for equal or older versions", () => {
    expect(isNewerVersion("1.2.0", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.1.9", "1.2.0")).toBe(false);
    expect(isNewerVersion("1.0", "1.0.1")).toBe(false);
  });

  it("treats missing trailing parts as zero", () => {
    expect(isNewerVersion("1.2.1", "1.2")).toBe(true);
    expect(isNewerVersion("1.2", "1.2.0")).toBe(false);
  });
});

describe("shouldForwardUpdaterErrorToRenderer", () => {
  it("filters signature and validation noise", () => {
    expect(
      shouldForwardUpdaterErrorToRenderer(
        "Code signature validation failed for update",
      ),
    ).toBe(false);
    expect(
      shouldForwardUpdaterErrorToRenderer("Update did not pass validation"),
    ).toBe(false);
    expect(
      shouldForwardUpdaterErrorToRenderer("SecErrorDomain: SecError -67061"),
    ).toBe(false);
    expect(
      shouldForwardUpdaterErrorToRenderer(
        "Failed to verify the update signature",
      ),
    ).toBe(false);
  });

  it("forwards actionable updater errors", () => {
    expect(shouldForwardUpdaterErrorToRenderer("Network request failed")).toBe(
      true,
    );
    expect(
      shouldForwardUpdaterErrorToRenderer("Unable to download update"),
    ).toBe(true);
  });
});
