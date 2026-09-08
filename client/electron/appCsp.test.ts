import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAppCspHeader, shouldAttachAppCsp } from "./appCsp";

const parseCspDirectives = (csp: string) =>
  new Map(
    csp
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name, sources];
      }),
  );

describe("buildAppCspHeader", () => {
  it("allows Canva-hosted images without allowing Canva scripts or connections", () => {
    const directives = parseCspDirectives(buildAppCspHeader(true));

    expect(directives.get("img-src")).toContain("https://*.canva.com");
    expect(directives.get("script-src")).not.toContain("https://*.canva.com");
    expect(directives.get("connect-src")).not.toContain("https://*.canva.com");
    expect(directives.get("img-src")).toContain("worshipsync-media:");
    expect(directives.get("media-src")).toContain("worshipsync-media:");
  });
});

describe("index.html meta CSP", () => {
  it("allows Electron local media schemes so they are not blocked by CSP intersection", () => {
    const html = readFileSync(join(__dirname, "../index.html"), "utf8");
    const metaMatch = html.match(
      /http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/,
    );

    expect(metaMatch).not.toBeNull();
    const directives = parseCspDirectives(metaMatch?.[1] ?? "");

    expect(directives.get("img-src")).toEqual(
      expect.arrayContaining(["media-cache:", "worshipsync-media:"]),
    );
    expect(directives.get("media-src")).toEqual(
      expect.arrayContaining(["media-cache:", "worshipsync-media:"]),
    );
    expect(directives.get("connect-src")).toEqual(
      expect.arrayContaining(["media-cache:", "worshipsync-media:"]),
    );
  });
});

describe("shouldAttachAppCsp", () => {
  it("allows the development WorshipSync main renderer", () => {
    expect(
      shouldAttachAppCsp(
        {
          url: "https://local.worshipsync.net:3000/#/controller",
          resourceType: "mainFrame",
        },
        false,
      ),
    ).toBe(true);
  });

  it("allows the packaged file main renderer", () => {
    expect(
      shouldAttachAppCsp(
        {
          url: "file:///C:/Program%20Files/WorshipSync/renderer/index.html",
          resourceType: "mainFrame",
        },
        true,
      ),
    ).toBe(true);
  });

  it.each([
    {
      url: "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE",
      resourceType: "subFrame",
      isPackaged: false,
    },
    {
      url: "https://rr2---sn.example.googlevideo.com/videoplayback",
      resourceType: "media",
      isPackaged: false,
    },
    {
      url: "https://open.spotify.com/embed/track/example",
      resourceType: "subFrame",
      isPackaged: false,
    },
    {
      url: "https://local.worshipsync.net.evil.example/",
      resourceType: "mainFrame",
      isPackaged: false,
    },
    {
      url: "https://www.youtube.com/",
      resourceType: "mainFrame",
      isPackaged: true,
    },
  ])(
    "does not attach the app CSP to $url",
    ({ url, resourceType, isPackaged }) => {
      expect(shouldAttachAppCsp({ url, resourceType }, isPackaged)).toBe(false);
    },
  );
});
