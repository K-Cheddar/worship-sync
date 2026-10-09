const packagedElectron = { value: false };

jest.mock("../../utils/environment", () => ({
  getApiBasePath: () => "http://localhost:5000/",
  isPackagedElectronRenderer: () => packagedElectron.value,
}));

const csrfStore = { token: "" };
const humanApiTokenStore = { value: "" };
const workstationTokenStore = { value: "" };

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
  getWorkstationToken: () => workstationTokenStore.value,
  setOperatorNameStorage: jest.fn(),
}));

// Imports follow jest.mock factories; module under test must load after mocks.
// eslint-disable-next-line import/first -- see above
import {
  apiFetch,
  createHumanSession,
  getAuthBootstrap,
  logoutSession,
  removeChurchMember,
  revokeTrustedDevice,
  resendChurchInvite,
  uploadSongAudio,
  updateChurchMemberAccess,
} from "../auth";
// eslint-disable-next-line import/first -- use the authenticated client setup above
import { getCanvaStatus, importCanvaDesign } from "../canva";
// eslint-disable-next-line import/first -- see mocked module setup above
import {
  setAuthenticatedSessionExpected,
  registerAuthErrorHandler,
  registerAuthRecoveryHandler,
} from "../authErrorBus";

describe("api/auth", () => {
  beforeEach(() => {
    csrfStore.token = "";
    packagedElectron.value = false;
    humanApiTokenStore.value = "";
    workstationTokenStore.value = "";
    setAuthenticatedSessionExpected(false);
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
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

  it("sends caller headers and workstation authentication through apiFetch", async () => {
    workstationTokenStore.value = "ws-full-access";
    csrfStore.token = "csrf-test-token";
    await apiFetch("api/test", {
      method: "POST",
      headers: {
        Accept: "application/x-test",
        "Content-Type": "application/vnd.test+json",
      },
      body: JSON.stringify({}),
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/test",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          Accept: "application/x-test",
          "Content-Type": "application/vnd.test+json",
          "x-workstation-token": "ws-full-access",
          "x-csrf-token": "csrf-test-token",
        }),
      }),
    );
  });

  it("loads Canva status for a paired full-access workstation", async () => {
    workstationTokenStore.value = "ws-full-access";
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          oauthConfigured: true,
          connected: true,
          accountLabel: "Church Canva",
        }),
    });

    await expect(getCanvaStatus("church-1")).resolves.toMatchObject({
      oauthConfigured: true,
      connected: true,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/churches/church-1/canva/status",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          "x-workstation-token": "ws-full-access",
        }),
      }),
    );
  });

  it("sends workstation authentication with the streamed Canva import", async () => {
    workstationTokenStore.value = "ws-full-access";
    csrfStore.token = "csrf-test-token";
    const result = { assets: [], skippedCount: 0, revision: 1 };
    const encoder = new TextEncoder();
    const reader = {
      read: jest.fn().mockResolvedValueOnce({
        value: encoder.encode(
          `{"type":"complete","result":${JSON.stringify(result)}}\n`,
        ),
        done: true,
      }),
    };
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/x-ndjson" }),
      body: { getReader: () => reader },
    });
    const progress: Array<{ type: string }> = [];

    await expect(
      importCanvaDesign(
        "church-1",
        {
          designId: "design-1",
          pages: [1],
          format: "png",
          existingImportKeys: [],
        },
        (event) => progress.push(event),
      ),
    ).resolves.toEqual(result);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/churches/church-1/canva/imports",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          "x-workstation-token": "ws-full-access",
          "x-csrf-token": "csrf-test-token",
          Accept: "application/x-ndjson, application/json",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(progress.map(({ type }) => type)).toEqual(["complete"]);
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

  it("posts church invite resends to the invite-specific endpoint", async () => {
    await resendChurchInvite("church-1", "invite-7");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/churches/church-1/invites/invite-7/resend",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
  });

  it("posts member access updates with Controller, appAccess, and permissions", async () => {
    await updateChurchMemberAccess("church-1", "user-8", "music", {
      teams: "view",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:5000/api/churches/church-1/members/user-8/access",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          controllerAccess: "music",
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
      contentType: "audio/mpeg" as const,
      sizeBytes: 3,
      uploadedAt: "2026-08-09T12:00:00.000Z",
    };
    const pendingAudio = {
      id: "audio-pending",
      key: "pending/churches/church-1/songs/song-1/audio-pending.mp3",
      fileName: "replacement.mp3",
      contentType: "audio/mpeg" as const,
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
      contentType: "audio/mpeg" as const,
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

  it("retries an ambiguous packaged MP3 upload with the same operation ID", async () => {
    packagedElectron.value = true;
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Upload completion failed" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ audio: { id: "audio-new" } }),
      });

    await uploadSongAudio({
      churchId: "church-1",
      songId: "song-1",
      file: new File([new Uint8Array([1, 2, 3])], "replacement.mp3", {
        type: "audio/mpeg",
      }),
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const firstHeaders = (global.fetch as jest.Mock).mock.calls[0][1].headers;
    const secondHeaders = (global.fetch as jest.Mock).mock.calls[1][1].headers;
    expect(firstHeaders["x-song-audio-upload-id"]).toBeTruthy();
    expect(secondHeaders["x-song-audio-upload-id"]).toBe(
      firstHeaders["x-song-audio-upload-id"],
    );
  });

  it("silently recovers a 401 session and retries the request once", async () => {
    setAuthenticatedSessionExpected(true);
    const recoveryHandler = jest.fn(() => Promise.resolve(true));
    const authErrorHandler = jest.fn();
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    const unsubscribeError = registerAuthErrorHandler(authErrorHandler);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({ errorMessage: "Authentication required" }),
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

  it("recreates a lost server session from Firebase and retries without a global toast", async () => {
    setAuthenticatedSessionExpected(true);
    const persistedFirebaseUser = {
      getIdToken: jest.fn((_forceRefresh: boolean) =>
        Promise.resolve("fresh-firebase-id-token"),
      ),
    };
    const recoveryHandler = jest.fn(async () => {
      const idToken = await persistedFirebaseUser.getIdToken(true);
      await createHumanSession(
        { idToken, deviceId: "device-1" },
        { notifyAuthError: false },
      );
      return true;
    });
    const authErrorHandler = jest.fn();
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    const unsubscribeError = registerAuthErrorHandler(authErrorHandler);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({ errorMessage: "Authentication required" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            success: true,
            bootstrap: { authenticated: true },
          }),
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

    expect(persistedFirebaseUser.getIdToken).toHaveBeenCalledWith(true);
    expect(recoveryHandler).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect((global.fetch as jest.Mock).mock.calls[2][0]).toBe(
      (global.fetch as jest.Mock).mock.calls[0][0],
    );
    expect((global.fetch as jest.Mock).mock.calls[2][1].method).toBe(
      (global.fetch as jest.Mock).mock.calls[0][1].method,
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:5000/api/auth/session",
      expect.objectContaining({
        body: JSON.stringify({
          idToken: "fresh-firebase-id-token",
          deviceId: "device-1",
        }),
      }),
    );
    expect(authErrorHandler).not.toHaveBeenCalled();
  });

  it("recovers a stale workstation CSRF token through bootstrap and retries once", async () => {
    setAuthenticatedSessionExpected(true);
    workstationTokenStore.value = "ws-1";
    csrfStore.token = "old-csrf";
    const recoveryHandler = jest.fn(async () => {
      const bootstrap = await getAuthBootstrap({ workstationToken: "ws-1" });
      csrfStore.token = bootstrap.csrfToken || "";
      return bootstrap.authenticated;
    });
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () =>
          Promise.resolve({
            errorMessage: "Could not verify this request.",
            code: "AUTH_CSRF_MISMATCH",
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ authenticated: true, csrfToken: "new-csrf" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true }),
      });

    try {
      await expect(
        apiFetch("api/workstations/device-1/operator", {
          method: "POST",
          body: JSON.stringify({ operatorName: "Sam" }),
        }),
      ).resolves.toEqual({ success: true });
    } finally {
      unsubscribeRecovery();
    }

    expect(recoveryHandler).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:5000/api/workstations/device-1/operator",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-csrf-token": "old-csrf" }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:5000/api/auth/me",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "x-workstation-token": "ws-1" }),
      }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      "http://localhost:5000/api/workstations/device-1/operator",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-csrf-token": "new-csrf" }),
      }),
    );
  });

  it("does not recover or retry an ordinary permission 403", async () => {
    setAuthenticatedSessionExpected(true);
    const recoveryHandler = jest.fn(() => Promise.resolve(true));
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({ error: "Full access is required.", code: "FORBIDDEN" }),
    });

    try {
      await expect(
        apiFetch("api/test", { method: "POST" }),
      ).rejects.toMatchObject({
        message: "Full access is required.",
        status: 403,
        code: "FORBIDDEN",
      });
    } finally {
      unsubscribeRecovery();
    }

    expect(recoveryHandler).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces the original CSRF error when auth recovery fails", async () => {
    setAuthenticatedSessionExpected(true);
    const recoveryHandler = jest.fn(() => Promise.resolve(false));
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          error: "Could not verify this request.",
          code: "AUTH_CSRF_MISMATCH",
        }),
    });

    try {
      await expect(apiFetch("api/test", { method: "POST" })).rejects.toMatchObject({
        message: "Could not verify this request.",
        status: 403,
        code: "AUTH_CSRF_MISMATCH",
      });
    } finally {
      unsubscribeRecovery();
    }

    expect(recoveryHandler).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not start another recovery when a retry still has a CSRF mismatch", async () => {
    setAuthenticatedSessionExpected(true);
    const recoveryHandler = jest.fn(() => Promise.resolve(true));
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ code: "AUTH_CSRF_MISMATCH", error: "CSRF 1" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ code: "AUTH_CSRF_MISMATCH", error: "CSRF 2" }),
      });

    try {
      await expect(apiFetch("api/test", { method: "POST" })).rejects.toMatchObject({
        message: "CSRF 2",
        status: 403,
        code: "AUTH_CSRF_MISMATCH",
      });
    } finally {
      unsubscribeRecovery();
    }

    expect(recoveryHandler).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not use CSRF mutation recovery for GET requests", async () => {
    setAuthenticatedSessionExpected(true);
    const recoveryHandler = jest.fn(() => Promise.resolve(true));
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ code: "AUTH_CSRF_MISMATCH", error: "CSRF" }),
    });

    try {
      await expect(apiFetch("api/test", { method: "GET" })).rejects.toMatchObject({
        status: 403,
        code: "AUTH_CSRF_MISMATCH",
      });
    } finally {
      unsubscribeRecovery();
    }

    expect(recoveryHandler).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("announces a 401 when silent recovery cannot restore the session", async () => {
    setAuthenticatedSessionExpected(true);
    const recoveryHandler = jest.fn(() => Promise.resolve(false));
    const authErrorHandler = jest.fn();
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    const unsubscribeError = registerAuthErrorHandler(authErrorHandler);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({ errorMessage: "Authentication required" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ authenticated: false }),
      });

    try {
      await expect(removeChurchMember("church-1", "user-7")).rejects.toEqual(
        expect.objectContaining({
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
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not show the global prompt for a signed-out or public request", async () => {
    const recoveryHandler = jest.fn(() => Promise.resolve(false));
    const authErrorHandler = jest.fn();
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    const unsubscribeError = registerAuthErrorHandler(authErrorHandler);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ errorMessage: "Invalid public token" }),
    });

    try {
      await expect(removeChurchMember("church-1", "user-7")).rejects.toEqual(
        expect.objectContaining({ status: 401 }),
      );
    } finally {
      unsubscribeRecovery();
      unsubscribeError();
    }

    expect(recoveryHandler).not.toHaveBeenCalled();
    expect(authErrorHandler).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not prompt for a stale 401 when the current session is valid", async () => {
    setAuthenticatedSessionExpected(true);
    const recoveryHandler = jest.fn(() => Promise.resolve(false));
    const authErrorHandler = jest.fn();
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    const unsubscribeError = registerAuthErrorHandler(authErrorHandler);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({ errorMessage: "Authentication required" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ authenticated: true }),
      });

    try {
      await expect(removeChurchMember("church-1", "user-7")).rejects.toEqual(
        expect.objectContaining({ status: 401 }),
      );
    } finally {
      unsubscribeRecovery();
      unsubscribeError();
    }

    expect(recoveryHandler).toHaveBeenCalledTimes(1);
    expect(authErrorHandler).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not turn an endpoint-specific 401 into a global sign-in prompt", async () => {
    setAuthenticatedSessionExpected(true);
    const recoveryHandler = jest.fn(() => Promise.resolve(false));
    const authErrorHandler = jest.fn();
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    const unsubscribeError = registerAuthErrorHandler(authErrorHandler);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "This action is not available" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ authenticated: true }),
      });

    try {
      await expect(removeChurchMember("church-1", "user-7")).rejects.toEqual(
        expect.objectContaining({
          message: "This action is not available",
          status: 401,
        }),
      );
    } finally {
      unsubscribeRecovery();
      unsubscribeError();
    }

    expect(authErrorHandler).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not claim sign-in failure when session verification is unreachable", async () => {
    setAuthenticatedSessionExpected(true);
    const recoveryHandler = jest.fn(() => Promise.resolve(false));
    const authErrorHandler = jest.fn();
    const unsubscribeRecovery = registerAuthRecoveryHandler(recoveryHandler);
    const unsubscribeError = registerAuthErrorHandler(authErrorHandler);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () =>
          Promise.resolve({ errorMessage: "Authentication required" }),
      })
      .mockRejectedValueOnce(new TypeError("network unavailable"));

    try {
      await expect(removeChurchMember("church-1", "user-7")).rejects.toEqual(
        expect.objectContaining({ status: 401 }),
      );
    } finally {
      unsubscribeRecovery();
      unsubscribeError();
    }

    expect(authErrorHandler).not.toHaveBeenCalled();
  });
});
