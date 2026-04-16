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
