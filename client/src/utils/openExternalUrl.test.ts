import { openExternalUrl } from "./openExternalUrl";

describe("openExternalUrl", () => {
  const originalElectronFlag = window.__ELECTRON__;
  const originalElectronApi = window.electronAPI;

  afterEach(() => {
    window.__ELECTRON__ = originalElectronFlag;
    window.electronAPI = originalElectronApi;
    jest.restoreAllMocks();
  });

  it("opens safe browser links in a new tab", async () => {
    const open = jest
      .spyOn(window, "open")
      .mockReturnValue({} as Window & typeof globalThis);

    await expect(openExternalUrl("https://example.test/resource")).resolves.toBe(
      true,
    );

    expect(open).toHaveBeenCalledWith(
      "https://example.test/resource",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("rejects unsafe schemes without opening the current page", async () => {
    const open = jest.spyOn(window, "open");
    const unsafeUrl = ["java", "script:alert(1)"].join("");

    await expect(openExternalUrl(unsafeUrl)).resolves.toBe(false);

    expect(open).not.toHaveBeenCalled();
  });

  it("uses the Electron external-link bridge for preview links", async () => {
    const openExternal = jest.fn().mockResolvedValue(true);
    window.__ELECTRON__ = true;
    window.electronAPI = {
      ...(originalElectronApi ?? {}),
      openExternalUrl: openExternal,
    } as typeof window.electronAPI;

    await expect(
      openExternalUrl("https://resource.example/file.pdf", {
        allowArbitraryHttps: true,
      }),
    ).resolves.toBe(true);

    expect(openExternal).toHaveBeenCalledWith(
      "https://resource.example/file.pdf",
      { allowArbitraryHttps: true },
    );
  });
});
