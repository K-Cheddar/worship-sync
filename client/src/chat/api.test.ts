import { sendChatMessage, uploadChatImage } from "./api";

const mockIsPackagedElectronRenderer = jest.fn(() => false);
const mockRequestAuthRecovery = jest.fn();

jest.mock("../utils/environment", () => ({
  getApiBasePath: () => "/",
  isPackagedElectronRenderer: () => mockIsPackagedElectronRenderer(),
}));

jest.mock("../utils/authStorage", () => ({
  getCsrfToken: () => "csrf",
  getHumanApiToken: () => null,
  getWorkstationToken: () => null,
}));

jest.mock("../api/authErrorBus", () => ({
  requestAuthRecovery: (...args: unknown[]) =>
    mockRequestAuthRecovery(...args),
}));

const createSuccessfulXhr = () => {
  const listeners: Record<string, Array<(event: ProgressEvent) => void>> = {};
  const uploadListeners: Record<
    string,
    Array<(event: ProgressEvent) => void>
  > = {};
  return {
    status: 200,
    open: jest.fn(),
    setRequestHeader: jest.fn(),
    send: jest.fn(() => {
      queueMicrotask(() => {
        uploadListeners.progress?.forEach((listener) =>
          listener({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent),
        );
        listeners.load?.forEach((listener) => listener({} as ProgressEvent));
      });
    }),
    upload: {
      addEventListener: jest.fn(
        (type: string, listener: (event: ProgressEvent) => void) => {
          uploadListeners[type] = uploadListeners[type] || [];
          uploadListeners[type].push(listener);
        },
      ),
    },
    addEventListener: jest.fn(
      (type: string, listener: (event: ProgressEvent) => void) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(listener);
      },
    ),
  };
};

describe("chat image API", () => {
  const originalFetch = global.fetch;
  const originalXhr = global.XMLHttpRequest;

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    global.XMLHttpRequest = originalXhr;
    mockIsPackagedElectronRenderer.mockReturnValue(false);
    mockRequestAuthRecovery.mockReset();
    jest.restoreAllMocks();
  });

  it("refreshes auth and retries a chat mutation after a CSRF rejection", async () => {
    mockRequestAuthRecovery.mockResolvedValue(true);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "Could not verify this request." }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ message: { messageId: "chat_1" } }),
      });

    await expect(
      sendChatMessage("church_1", {
        text: "Hello",
        clientMessageId: "client_12345678",
        timeZone: "UTC",
      }),
    ).resolves.toEqual({ message: { messageId: "chat_1" } });

    expect(mockRequestAuthRecovery).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("requests a private intent and uploads directly to its signed URL", async () => {
    const imageUpload = {
      id: "12345678-1234-4123-8123-123456789abc",
      fileName: "stage.png",
      contentType: "image/png" as const,
      sizeBytes: 10,
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        imageUpload,
        uploadUrl: "https://r2.example.test/signed-put",
        expiresAt: "2026-08-10T17:00:00Z",
      }),
    });
    const xhr = createSuccessfulXhr();
    global.XMLHttpRequest = jest.fn(
      () => xhr,
    ) as unknown as typeof XMLHttpRequest;
    const progress: number[] = [];

    const result = await uploadChatImage(
      "church_1",
      new File(["0123456789"], "stage.png", { type: "image/png" }),
      (value) => progress.push(value),
    );

    expect(result).toEqual(imageUpload);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/churches/church_1/chat/images/upload",
      expect.objectContaining({ method: "POST" }),
    );
    expect(xhr.open).toHaveBeenCalledWith(
      "PUT",
      "https://r2.example.test/signed-put",
    );
    expect(progress).toEqual([50, 100]);
  });

  it("rejects unsupported images before requesting storage", async () => {
    global.fetch = jest.fn();
    await expect(
      uploadChatImage(
        "church_1",
        new File(["gif"], "animation.gif", { type: "image/gif" }),
      ),
    ).rejects.toThrow("Choose a JPEG, PNG, or WebP image.");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("allows photo message finalization to run longer than normal chat requests", async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    global.fetch = jest.fn((_url, init) => {
      const signal = init?.signal as AbortSignal;
      requestSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }) as jest.MockedFunction<typeof fetch>;

    const pending = sendChatMessage("church_1", {
      text: "",
      clientMessageId: "client_photo_1234",
      timeZone: "UTC",
      imageUpload: {
        id: "12345678-1234-4123-8123-123456789abc",
        fileName: "stage.png",
        contentType: "image/png",
        sizeBytes: 10,
      },
    });
    const outcome = pending.then(
      () => null,
      (error: unknown) => error,
    );

    await jest.advanceTimersByTimeAsync(15_000);
    expect(requestSignal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(225_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Chat took too long to respond. Try again.",
    );
  });

  it("allows packaged Electron photo uploads more than 15 seconds", async () => {
    jest.useFakeTimers();
    mockIsPackagedElectronRenderer.mockReturnValue(true);
    let requestSignal: AbortSignal | undefined;
    global.fetch = jest.fn((_url, init) => {
      const signal = init?.signal as AbortSignal;
      requestSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }) as jest.MockedFunction<typeof fetch>;

    const pending = uploadChatImage(
      "church_1",
      new File(["0123456789"], "stage.png", { type: "image/png" }),
    );
    const outcome = pending.then(
      () => null,
      (error: unknown) => error,
    );

    await jest.advanceTimersByTimeAsync(15_000);
    expect(requestSignal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(225_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "The photo upload took too long. Try again.",
    );
  });
});
