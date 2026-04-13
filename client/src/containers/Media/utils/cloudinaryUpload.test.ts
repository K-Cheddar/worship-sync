import { uploadImageToCloudinary } from "./cloudinaryUpload";

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

describe("uploadImageToCloudinary", () => {
  const OriginalXHR = global.XMLHttpRequest;

  afterEach(() => {
    global.XMLHttpRequest = OriginalXHR;
    jest.restoreAllMocks();
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
});
