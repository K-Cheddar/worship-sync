import { render, screen, waitFor } from "@testing-library/react";
import WebUpdateCoordinator from "./WebUpdateCoordinator";
import { isElectron } from "../../utils/environment";
import {
  getBuildTimeVersion,
  getServerVersionInfo,
} from "../../utils/versionUtils";
import {
  checkForUpdate,
} from "../../serviceWorkerRegistration";

jest.mock("../../utils/environment", () => ({
  isElectron: jest.fn(),
}));

jest.mock("../../utils/versionUtils", () => ({
  getBuildTimeVersion: jest.fn(),
  getServerVersionInfo: jest.fn(),
  isNewerVersion: jest.requireActual("../../utils/versionUtils").isNewerVersion,
}));

jest.mock("../../serviceWorkerRegistration", () => ({
  checkForUpdate: jest.fn(),
  reloadPage: jest.fn(),
}));

const mockIsElectron = jest.mocked(isElectron);
const mockGetBuildTimeVersion = jest.mocked(getBuildTimeVersion);
const mockGetServerVersionInfo = jest.mocked(getServerVersionInfo);
const mockCheckForUpdate = jest.mocked(checkForUpdate);

describe("WebUpdateCoordinator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsElectron.mockReturnValue(false);
    mockGetBuildTimeVersion.mockReturnValue("2.23.0");
    mockGetServerVersionInfo.mockResolvedValue({
      version: "2.23.0",
      minSupportedWebVersion: null,
    });
    mockCheckForUpdate.mockResolvedValue("updated");
  });

  it("does not interrupt normal web updates", async () => {
    render(<WebUpdateCoordinator isTransparentRoute={false} />);

    await waitFor(() => {
      expect(mockGetServerVersionInfo).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mockCheckForUpdate).not.toHaveBeenCalled();
  });

  it("blocks an unsupported web version and attempts the required update", async () => {
    mockGetServerVersionInfo.mockResolvedValue({
      version: "2.24.0",
      minSupportedWebVersion: "2.24.0",
    });
    mockCheckForUpdate.mockResolvedValue("unavailable");

    render(<WebUpdateCoordinator isTransparentRoute={false} />);

    expect(
      await screen.findByRole("heading", { name: /Update required/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByText(/Check your connection, then try the update again/i),
    ).toBeInTheDocument();
  });

  it("keeps transparent display routes visually empty during a required update", async () => {
    mockGetServerVersionInfo.mockResolvedValue({
      version: "2.24.0",
      minSupportedWebVersion: "2.24.0",
    });
    mockCheckForUpdate.mockResolvedValue("unavailable");

    render(<WebUpdateCoordinator isTransparentRoute />);

    await waitFor(() => {
      expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByRole("heading", { name: /Update required/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
