import { loginUser } from "./login";

jest.mock("../utils/environment", () => ({
  getApiBasePath: jest.fn(() => "https://api.example.com/"),
}));

describe("loginUser", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    (global as unknown as { fetch?: typeof fetch }).fetch = undefined;
  });

  it("posts credentials and returns parsed response", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        success: true,
        errorMessage: "",
        user: {
          username: "admin",
          database: "db1",
          upload_preset: "preset",
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await loginUser("admin", "secret");

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "admin", password: "secret" }),
    });
    expect(result).toEqual({
      success: true,
      errorMessage: "",
      user: {
        username: "admin",
        database: "db1",
        upload_preset: "preset",
      },
    });
  });

  it("returns network fallback response when fetch throws", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const result = await loginUser("admin", "secret");

    expect(errorSpy).toHaveBeenCalledWith(
      "Login API error:",
      expect.any(Error),
    );
    expect(result).toEqual({
      success: false,
      errorMessage: "Network error",
    });
  });
});
