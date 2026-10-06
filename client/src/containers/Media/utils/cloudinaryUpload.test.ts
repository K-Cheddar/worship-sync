import {
  convertCloudinaryImageToLocalWebp,
  uploadImageToCloudinary,
} from "./cloudinaryUpload";

function mockXhrSuccess(responseText: string) {
  const listeners: Record<string, ((ev: unknown) => void)[]> = {};
  const uploadListeners: Record<string, ((ev: unknown) => void)[]> = {};

  const xhr = {
    open: jest.fn(),
    send: jest.fn(() => {
      queueMicrotask(() => {
        (listeners.load || []).forEach((fn) => fn({}));
      });
    }),
    status: 200,
    responseText,
    upload: {
      addEventListener: jest.fn((type: string, fn: (ev: unknown) => void) => {
        uploadListeners[type] = uploadListeners[type] || [];
        uploadListeners[type].push(fn);
      }),
    },
    addEventListener: jest.fn((type: string, fn: (ev: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    }),
    abort: jest.fn(),
  };

  return xhr as unknown as XMLHttpRequest;
}

function mockXhrResponse({
  responseText = "",
  response,
}: {
  responseText?: string;
  response?: Blob;
}) {
  const listeners: Record<string, ((ev: unknown) => void)[]> = {};
  const xhr = {
    open: jest.fn(),
    send: jest.fn(() => {
      queueMicrotask(() => {
        (listeners.load || []).forEach((fn) => fn({}));
      });
    }),
    status: 200,
    responseText,
    response,
    responseType: "",
    upload: { addEventListener: jest.fn() },
    addEventListener: jest.fn((type: string, fn: (ev: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    }),
    abort: jest.fn(),
  };
  return xhr as unknown as XMLHttpRequest;
}

describe("uploadImageToCloudinary", () => {
  const OriginalXHR = global.XMLHttpRequest;

  afterEach(() => {
    global.XMLHttpRequest = OriginalXHR;
    jest.restoreAllMocks();
  });

  it("sends dynamic asset folder placement without sending it as a legacy folder", async () => {
    const file = new File(["x"], "welcome.png", { type: "image/png" });
    const responseJson = JSON.stringify({
      public_id: "welcome_123",
      secure_url: "https://cdn.example/welcome_123.png",
      width: 100,
      height: 80,
      format: "png",
      created_at: "2026-01-01T00:00:00.000Z",
      bytes: 10,
    });
    const xhr = mockXhrSuccess(responseJson);
    global.XMLHttpRequest = jest.fn(() => xhr) as unknown as typeof XMLHttpRequest;

    await uploadImageToCloudinary(file, "preset", "test-cloud", {}, {
      assetFolder: "worship-sync/churches/church-1/media",
    });

    const formData = (xhr.send as jest.Mock).mock.calls[0][0] as FormData;
    expect(formData.get("asset_folder")).toBe(
      "worship-sync/churches/church-1/media",
    );
    expect(formData.get("folder")).toBeNull();
  });

  it("continues to send legacy folder for callers that explicitly request it", async () => {
    const file = new File(["x"], "profile.png", { type: "image/png" });
    const responseJson = JSON.stringify({
      public_id: "profile_123",
      secure_url: "https://cdn.example/profile_123.png",
      width: 100,
      height: 80,
      format: "png",
      created_at: "2026-01-01T00:00:00.000Z",
      bytes: 10,
    });
    const xhr = mockXhrSuccess(responseJson);
    global.XMLHttpRequest = jest.fn(() => xhr) as unknown as typeof XMLHttpRequest;

    await uploadImageToCloudinary(file, "preset", "test-cloud", {}, {
      folder: "member-profiles/church-1",
    });

    const formData = (xhr.send as jest.Mock).mock.calls[0][0] as FormData;
    expect(formData.get("folder")).toBe("member-profiles/church-1");
    expect(formData.get("asset_folder")).toBeNull();
  });

  it("prefers local file.name over Cloudinary original_filename", async () => {
    const file = new File(["x"], "vacation.png", { type: "image/png" });
    const responseJson = JSON.stringify({
      public_id: "vacation_xyz789",
      original_filename: "vacation_xyz789",
      secure_url: "https://cdn.example/vacation_xyz789.png",
      url: "https://cdn.example/vacation_xyz789.png",
      width: 100,
      height: 80,
      format: "png",
      created_at: "2026-01-01T00:00:00.000Z",
      bytes: 10,
    });

    global.XMLHttpRequest = jest.fn(() =>
      mockXhrSuccess(responseJson),
    ) as unknown as typeof XMLHttpRequest;

    const result = await uploadImageToCloudinary(file, "preset", "test-cloud");

    expect(result.original_filename).toBe("vacation.png");
    expect(result.public_id).toBe("vacation_xyz789");
  });

  it("falls back to response original_filename when file.name is empty", async () => {
    const file = new File(["x"], "", { type: "image/png" });
    const responseJson = JSON.stringify({
      public_id: "only_api",
      original_filename: "from_api.jpg",
      secure_url: "https://cdn.example/from_api.jpg",
      url: "https://cdn.example/from_api.jpg",
      width: 1,
      height: 1,
      format: "jpg",
      created_at: "2026-01-01T00:00:00.000Z",
      bytes: 1,
    });

    global.XMLHttpRequest = jest.fn(() =>
      mockXhrSuccess(responseJson),
    ) as unknown as typeof XMLHttpRequest;

    const result = await uploadImageToCloudinary(file, "preset", "test-cloud");

    expect(result.original_filename).toBe("from_api.jpg");
  });

  it("rejects when the success body is not valid JSON", async () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    global.XMLHttpRequest = jest.fn(() =>
      mockXhrSuccess("not json {{{"),
    ) as unknown as typeof XMLHttpRequest;

    await expect(
      uploadImageToCloudinary(file, "preset", "test-cloud"),
    ).rejects.toThrow(/could not be read/);
  });

  it("rejects when the success body is JSON but not an object", async () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    global.XMLHttpRequest = jest.fn(() =>
      mockXhrSuccess("null"),
    ) as unknown as typeof XMLHttpRequest;

    await expect(
      uploadImageToCloudinary(file, "preset", "test-cloud"),
    ).rejects.toThrow(/not valid upload data/);
  });

  it("rejects when public_id is missing", async () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    const responseJson = JSON.stringify({
      secure_url: "https://cdn.example/x.png",
      width: 1,
      height: 1,
      format: "png",
      created_at: "2026-01-01T00:00:00.000Z",
      bytes: 1,
    });
    global.XMLHttpRequest = jest.fn(() =>
      mockXhrSuccess(responseJson),
    ) as unknown as typeof XMLHttpRequest;

    await expect(
      uploadImageToCloudinary(file, "preset", "test-cloud"),
    ).rejects.toThrow(/public_id/);
  });

  it("rejects when secure_url is missing", async () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    const responseJson = JSON.stringify({
      public_id: "x",
      width: 1,
      height: 1,
      format: "png",
      created_at: "2026-01-01T00:00:00.000Z",
      bytes: 1,
    });
    global.XMLHttpRequest = jest.fn(() =>
      mockXhrSuccess(responseJson),
    ) as unknown as typeof XMLHttpRequest;

    await expect(
      uploadImageToCloudinary(file, "preset", "test-cloud"),
    ).rejects.toThrow(/secure_url/);
  });

  it("rejects when width/height are not positive numbers", async () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    const responseJson = JSON.stringify({
      public_id: "x",
      secure_url: "https://cdn.example/x.png",
      width: 0,
      height: 1,
      format: "png",
      created_at: "2026-01-01T00:00:00.000Z",
      bytes: 1,
    });
    global.XMLHttpRequest = jest.fn(() =>
      mockXhrSuccess(responseJson),
    ) as unknown as typeof XMLHttpRequest;

    await expect(
      uploadImageToCloudinary(file, "preset", "test-cloud"),
    ).rejects.toThrow(/width/);
  });

  it("converts an image through a temporary Cloudinary asset and cleans it up", async () => {
    const file = new File(["source"], "design.heic", { type: "image/heic" });
    const uploadXhr = mockXhrResponse({
      responseText: JSON.stringify({
        public_id: "temporary-conversions/design",
        secure_url:
          "https://res.cloudinary.com/portable-media/image/upload/v123/design.heic",
        width: 100,
        height: 80,
        format: "heic",
        created_at: "2026-01-01T00:00:00.000Z",
        bytes: 10,
      }),
    });
    const downloadXhr = mockXhrResponse({
      response: new Blob(["webp"], { type: "image/webp" }),
    });
    const xhrs = [uploadXhr, downloadXhr];
    global.XMLHttpRequest = jest.fn(
      () => xhrs.shift()!,
    ) as unknown as typeof XMLHttpRequest;
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);

    const result = await convertCloudinaryImageToLocalWebp(
      file,
      "preset",
      {},
      "church-1",
    );

    expect(result.name).toBe("design.webp");
    expect(result.type).toBe("image/webp");
    expect(downloadXhr.open).toHaveBeenCalledWith(
      "GET",
      "https://res.cloudinary.com/portable-media/image/upload/f_webp,q_auto/v123/design.webp",
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("api/cloudinary/delete"),
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({
          publicId: "temporary-conversions/design",
          resourceType: "image",
        }),
      }),
    );
  });
});
