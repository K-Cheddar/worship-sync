import { humanizeUpdateError } from "./updateMessages";

describe("humanizeUpdateError", () => {
  it("returns connection guidance for empty input", () => {
    expect(humanizeUpdateError("")).toContain("connection");
  });

  it("maps common network-style messages", () => {
    expect(humanizeUpdateError("net::ERR_INTERNET_DISCONNECTED")).toContain(
      "connection",
    );
    expect(humanizeUpdateError("getaddrinfo ENOTFOUND example.com")).toContain(
      "connection",
    );
  });

  it("maps macOS signature validation errors to a GitHub download hint", () => {
    expect(
      humanizeUpdateError(
        "Code signature at URL file:///... did not pass validation",
      ),
    ).toContain("Mac");
  });

  it("maps Windows publisher mismatch errors without mac-specific wording", () => {
    expect(
      humanizeUpdateError(
        "New version 9.9.9 is not signed by the application owner: mismatch",
      ),
    ).toContain("publisher");
  });

  it("maps missing installer cache errors to actionable guidance", () => {
    expect(
      humanizeUpdateError(
        "No update filepath provided, can't quit and install",
      ),
    ).toContain("Check for updates");
  });

  it("passes through short unknown messages", () => {
    expect(humanizeUpdateError("Custom vendor message")).toBe(
      "Custom vendor message",
    );
  });

  it("truncates very long messages", () => {
    const long = "x".repeat(200);
    expect(humanizeUpdateError(long).length).toBeLessThanOrEqual(160);
    expect(humanizeUpdateError(long).endsWith("…")).toBe(true);
  });
});
