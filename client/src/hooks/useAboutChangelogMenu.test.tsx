import { renderHook, waitFor } from "@testing-library/react";
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
});
