import { assertAllowedOpenExternalUrl } from "./openExternalUrlAllowlist";

describe("assertAllowedOpenExternalUrl", () => {
  const originalHosts = process.env.WORSHIPSYNC_OPEN_EXTERNAL_HOSTS;

  afterEach(() => {
    if (originalHosts === undefined) {
      delete process.env.WORSHIPSYNC_OPEN_EXTERNAL_HOSTS;
    } else {
      process.env.WORSHIPSYNC_OPEN_EXTERNAL_HOSTS = originalHosts;
    }
  });

  it("allows https www.worshipsync.net in production mode", () => {
    expect(() =>
      assertAllowedOpenExternalUrl("https://www.worshipsync.net/#/login", {
        isDev: false,
      }),
    ).not.toThrow();
  });

  it("allows https local.worshipsync.net", () => {
    expect(() =>
      assertAllowedOpenExternalUrl("https://local.worshipsync.net:3000/", {
        isDev: true,
      }),
    ).not.toThrow();
  });

  it("allows http localhost only when isDev", () => {
    expect(() =>
      assertAllowedOpenExternalUrl("http://localhost:3000/", { isDev: true }),
    ).not.toThrow();
    expect(() =>
      assertAllowedOpenExternalUrl("http://localhost:3000/", { isDev: false }),
    ).toThrow(/Insecure links/);
  });

  it("rejects arbitrary https hosts", () => {
    expect(() =>
      assertAllowedOpenExternalUrl("https://evil.example/phish", {
        isDev: false,
      }),
    ).toThrow(/allowed list/);
  });

  it("rejects non-http(s) schemes", () => {
    expect(() =>
      assertAllowedOpenExternalUrl("javascript:alert(1)", { isDev: true }),
    ).toThrow(/Only http and https/);
  });

  it("respects WORSHIPSYNC_OPEN_EXTERNAL_HOSTS for extra hosts", () => {
    process.env.WORSHIPSYNC_OPEN_EXTERNAL_HOSTS = "extra.example";
    expect(() =>
      assertAllowedOpenExternalUrl("https://extra.example/path", {
        isDev: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertAllowedOpenExternalUrl("https://www.worshipsync.net/", {
        isDev: false,
      }),
    ).toThrow(/allowed list/);
  });
});
