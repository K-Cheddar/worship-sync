import { buildAppCspHeader, shouldAttachAppCsp } from "./appCsp";

describe("buildAppCspHeader", () => {
  it("allows Canva-hosted images without allowing Canva scripts or connections", () => {
    const header = buildAppCspHeader(true);
    const directives = new Map(
      header
        .split(";")
        .map((directive) => directive.trim())
        .filter(Boolean)
        .map((directive) => {
          const [name, ...sources] = directive.split(/\s+/);
          return [name, sources];
        }),
    );

    expect(directives.get("img-src")).toContain("https://*.canva.com");
    expect(directives.get("script-src")).not.toContain(
      "https://*.canva.com",
    );
    expect(directives.get("connect-src")).not.toContain(
      "https://*.canva.com",
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
  ])("does not attach the app CSP to $url", ({ url, resourceType, isPackaged }) => {
    expect(shouldAttachAppCsp({ url, resourceType }, isPackaged)).toBe(false);
  });
});
