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
  AuthApiError,
  getAuthBootstrap,
  logoutSession,
  removeChurchMember,
  revokeTrustedDevice,
  uploadSongAudio,
  updateChurchMemberAccess,
} from "../auth";
// eslint-disable-next-line import/first -- see mocked module setup above
import {
  registerAuthErrorHandler,
  registerAuthRecoveryHandler,
} from "../authErrorBus";

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

  it("posts member access updates with appAccess and permissions payload", async () => {
    await updateChurchMemberAccess("church-1", "user-8", "music", {
      teams: "view",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/churches/church-1/members/user-8/access",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          appAccess: "music",
          permissions: { teams: "view" },
        }),
      }),
    );
  });

  it("sends the current attachment when completing a browser MP3 replacement", async () => {
    const previousAudio = {
      id: "audio-current",
      key: "churches/church-1/songs/song-1/audio-current.mp3",
      fileName: "current.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 3,
      uploadedAt: "2026-08-09T12:00:00.000Z",
    };
    const pendingAudio = {
      id: "audio-pending",
      key: "pending/churches/church-1/songs/song-1/audio-pending.mp3",
      fileName: "replacement.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 3,
    };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            audio: pendingAudio,
            uploadUrl: "https://r2.example.test/pending",
            expiresAt: "2026-08-09T12:15:00.000Z",
          }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            audio: { ...previousAudio, fileName: "replacement.mp3" },
          }),
      });

    await uploadSongAudio({
      churchId: "church-1",
      songId: "song-1",
      file: new File([new Uint8Array([1, 2, 3])], "replacement.mp3", {
        type: "audio/mpeg",
      }),
      previousAudio,
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      "http://localhost:5000/api/churches/church-1/song-audio/song-1/complete",
      expect.objectContaining({
        body: JSON.stringify({ audio: pendingAudio, previousAudio }),
      }),
    );
  });

  it("sends the current attachment headers for a packaged Electron MP3 replacement", async () => {
    packagedElectron.value = true;
    const previousAudio = {
      id: "audio-current",
      key: "churches/church-1/songs/song-1/audio-current.mp3",
      fileName: "current.mp3",
      contentType: "audio/mpeg",
      sizeBytes: 3,
      uploadedAt: "2026-08-09T12:00:00.000Z",
    };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          audio: { ...previousAudio, fileName: "replacement.mp3" },
        }),
    });

    await uploadSongAudio({
      churchId: "church-1",
      songId: "song-1",
      file: new File([new Uint8Array([1, 2, 3])], "replacement.mp3", {
        type: "audio/mpeg",
      }),
      previousAudio,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/upload-from-app?fileName=replacement.mp3"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-song-audio-id": previousAudio.id,
          "x-song-audio-key": previousAudio.key,
        }),
      }),
    );
  });

  it("silently recovers a 401 session and retries the request once", async () => {
    const recoveryHandler = jest.fn(() => Promise.resolve(true));
    const authErrorHandler = jest.fn();
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    const unsubscribeError = registerAuthErrorHandler(authErrorHandler);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ errorMessage: "Authentication required" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true }),
      });

    try {
      await removeChurchMember("church-1", "user-7");
    } finally {
      unsubscribeRecovery();
      unsubscribeError();
    }

    expect(recoveryHandler).toHaveBeenCalledTimes(1);
    expect(authErrorHandler).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("announces a 401 when silent recovery cannot restore the session", async () => {
    const recoveryHandler = jest.fn(() => Promise.resolve(false));
    const authErrorHandler = jest.fn();
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    const unsubscribeError = registerAuthErrorHandler(authErrorHandler);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ errorMessage: "Authentication required" }),
    });

    try {
      await expect(removeChurchMember("church-1", "user-7")).rejects.toEqual(
        expect.objectContaining<AuthApiError>({
          message: "Authentication required",
          status: 401,
        }),
      );
    } finally {
      unsubscribeRecovery();
      unsubscribeError();
    }

    expect(recoveryHandler).toHaveBeenCalledTimes(1);
    expect(authErrorHandler).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
