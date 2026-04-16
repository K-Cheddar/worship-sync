const packagedElectron = { value: false };

jest.mock("../../utils/environment", () => ({
  getApiBasePath: () => "http://localhost:5000/",
  isPackagedElectronRenderer: () => packagedElectron.value,
}));

const csrfStore = { token: "" };
const humanApiTokenStore = { value: "" };

jest.mock("../../utils/authStorage", () => ({
  getCsrfToken: () => csrfStore.token,
  clearCsrfToken: jest.fn(),
  clearDisplayToken: jest.fn(),
  clearOperatorNameStorage: jest.fn(),
  clearWorkstationToken: jest.fn(),
  setCsrfToken: jest.fn(),
  getDisplayToken: () => "",
  getHumanApiToken: () => humanApiTokenStore.value,
  getOperatorName: () => "",
  getOrCreateDeviceId: () => "device-1",
  getWorkstationToken: () => "",
  setOperatorNameStorage: jest.fn(),
}));

// Imports follow jest.mock factories; module under test must load after mocks.
// eslint-disable-next-line import/first -- see above
import {
  getAuthBootstrap,
  logoutSession,
  removeChurchMember,
  revokeTrustedDevice,
  updateChurchMemberAccess,
} from "../auth";

describe("api/auth", () => {
  beforeEach(() => {
    csrfStore.token = "";
    packagedElectron.value = false;
    humanApiTokenStore.value = "";
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ authenticated: false }),
      }),
    ) as jest.Mock;
  });

  it("loads auth bootstrap with credentials and optional device headers", async () => {
    await getAuthBootstrap({
      workstationToken: "ws-1",
      displayToken: "dp-1",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/auth/me",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        headers: expect.objectContaining({
          "x-workstation-token": "ws-1",
          "x-display-token": "dp-1",
        }),
      }),
    );
  });

  it("sends Authorization Bearer when packaged Electron has a stored human API token", async () => {
    packagedElectron.value = true;
    humanApiTokenStore.value = "wsh_test_token";
    await getAuthBootstrap({});

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/auth/me",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        headers: expect.objectContaining({
          Authorization: "Bearer wsh_test_token",
        }),
      }),
    );
  });

  it("posts logout with credentials", async () => {
    await logoutSession();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });

  it("sends x-csrf-token on logout when a CSRF token is stored", async () => {
    csrfStore.token = "csrf-test-token";
    await logoutSession();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-csrf-token": "csrf-test-token",
        }),
      }),
    );
  });

  it("sends x-csrf-token on mutating POST when a CSRF token is stored", async () => {
    csrfStore.token = "csrf-test-token";
    await revokeTrustedDevice("device-xyz");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/devices/human/device-xyz/revoke",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-csrf-token": "csrf-test-token",
        }),
      }),
    );
  });

  it("posts member removal to the member endpoint", async () => {
    await removeChurchMember("church-1", "user-7");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/churches/church-1/members/user-7/remove",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });

  it("posts member access updates with appAccess payload", async () => {
    await updateChurchMemberAccess("church-1", "user-8", "music");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/churches/church-1/members/user-8/access",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ appAccess: "music" }),
      }),
    );
  });
});
