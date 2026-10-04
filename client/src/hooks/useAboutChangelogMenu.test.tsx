import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useAboutChangelogMenu } from "./useAboutChangelogMenu";
import { useElectronWindows } from "./useElectronWindows";
import {
  getBuildTimeVersion,
  getServerVersion,
} from "../utils/versionUtils";

jest.mock("./useElectronWindows", () => ({
  useElectronWindows: jest.fn(),
}));

jest.mock("../utils/versionUtils", () => ({
  getBuildTimeVersion: jest.fn(),
  getServerVersion: jest.fn(),
  isNewerVersion: jest.requireActual("../utils/versionUtils").isNewerVersion,
}));

const mockUseElectronWindows = jest.mocked(useElectronWindows);
const mockGetBuildTimeVersion = jest.mocked(getBuildTimeVersion);
const mockGetServerVersion = jest.mocked(getServerVersion);

describe("useAboutChangelogMenu", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("surfaces a web update badge when the server version is newer", async () => {
    mockUseElectronWindows.mockReturnValue({
      isElectron: false,
    } as ReturnType<typeof useElectronWindows>);
    mockGetBuildTimeVersion.mockReturnValue("2.6.2");
    mockGetServerVersion.mockResolvedValue("2.9.0");

    const { result } = renderHook(() => useAboutChangelogMenu());

    await waitFor(() => {
      expect(result.current.updateReadyVersion).toBe("2.9.0");
    });
  });

  it("does not show a web update badge when already on the latest version", async () => {
    mockUseElectronWindows.mockReturnValue({
      isElectron: false,
    } as ReturnType<typeof useElectronWindows>);
    mockGetBuildTimeVersion.mockReturnValue("2.9.0");
    mockGetServerVersion.mockResolvedValue("2.9.0");

    const { result } = renderHook(() => useAboutChangelogMenu());

    await waitFor(() => {
      expect(result.current.updateReadyVersion).toBe("");
    });
  });

  it("exposes What's New and keeps About available", () => {
    mockUseElectronWindows.mockReturnValue({
      isElectron: false,
    } as ReturnType<typeof useElectronWindows>);
    mockGetBuildTimeVersion.mockReturnValue("2.41.0");
    mockGetServerVersion.mockResolvedValue("2.41.0");
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ notes: [] }),
    } as Response);

    const { result } = renderHook(() => useAboutChangelogMenu());
    const { unmount } = render(result.current.aboutChangelogMenuItems[0].element);

    expect(screen.getByText("What's New")).toBeInTheDocument();
    unmount();
    act(() => result.current.aboutChangelogMenuItems[0].onClick?.());
    render(result.current.aboutChangelogModals);

    expect(screen.getByRole("dialog", { name: "What's New" })).toBeInTheDocument();
    expect(result.current.aboutChangelogMenuItems[1].element).toBeTruthy();
  });
});
