import { describe, expect, it } from "@jest/globals";
import {
  findDesktopAuthProtocolArg,
  parseDesktopAuthCallbackUrl,
} from "./desktopAuth";

describe("desktopAuth protocol helpers", () => {
  it("parseDesktopAuthCallbackUrl accepts worshipsync callback with desktopAuthId", () => {
    expect(
      parseDesktopAuthCallbackUrl(
        "worshipsync://auth/callback?desktopAuthId=abc123",
      ),
    ).toEqual({ desktopAuthId: "abc123" });
  });

  it("parseDesktopAuthCallbackUrl rejects other paths", () => {
    expect(
      parseDesktopAuthCallbackUrl("worshipsync://other?desktopAuthId=x"),
    ).toBeNull();
  });

  it("parseDesktopAuthCallbackUrl rejects other schemes", () => {
    expect(
      parseDesktopAuthCallbackUrl("https://x/auth/callback?desktopAuthId=x"),
    ).toBeNull();
  });

  it("parseDesktopAuthCallbackUrl rejects missing desktopAuthId", () => {
    expect(parseDesktopAuthCallbackUrl("worshipsync://auth/callback")).toBeNull();
  });

  it("findDesktopAuthProtocolArg returns first matching argv entry", () => {
    expect(
      findDesktopAuthProtocolArg([
        "/app/electron",
        "--flag",
        "worshipsync://auth/callback?desktopAuthId=z",
      ]),
    ).toBe("worshipsync://auth/callback?desktopAuthId=z");
  });
});
