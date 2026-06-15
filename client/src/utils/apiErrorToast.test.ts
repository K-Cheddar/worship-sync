import { AuthApiError } from "../api/auth";
import { AUTH_SIGN_IN_AGAIN_MESSAGE } from "./authUserMessages";
import {
  getApiErrorMessage,
  getPersistedFailureMessage,
  isAuthApiError,
  isAuthFailureMessage,
  resetAuthErrorToastStateForTests,
  showApiErrorToast,
} from "./apiErrorToast";

describe("apiErrorToast", () => {
  beforeEach(() => {
    resetAuthErrorToastStateForTests();
  });
  it("detects auth API errors", () => {
    expect(
      isAuthApiError(
        new AuthApiError("Authentication required", { status: 401 }),
      ),
    ).toBe(true);
    expect(isAuthApiError(new AuthApiError("Forbidden", { status: 403 }))).toBe(
      true,
    );
    expect(isAuthApiError(new AuthApiError("Not found", { status: 404 }))).toBe(
      false,
    );
    expect(isAuthApiError(new Error("Authentication required"))).toBe(false);
  });

  it("returns trimmed error messages with fallback", () => {
    expect(
      getApiErrorMessage(new Error("  Save failed  "), "Could not save."),
    ).toBe("Save failed");
    expect(getApiErrorMessage(new Error("   "), "Could not save.")).toBe(
      "Could not save.",
    );
    expect(getApiErrorMessage("bad input", "Could not save.")).toBe(
      "Could not save.",
    );
  });

  it("shows auth toast with refresh action for 401/403 errors", () => {
    const showToast = jest.fn();

    showApiErrorToast(
      showToast,
      new AuthApiError("Authentication required", { status: 401 }),
      "Could not save.",
    );

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: AUTH_SIGN_IN_AGAIN_MESSAGE,
        variant: "error",
        persist: true,
        children: expect.any(Function),
      }),
    );
  });

  it("shows plain error toast for non-auth errors", () => {
    const showToast = jest.fn();

    showApiErrorToast(showToast, new Error("Save failed"), "Could not save.");

    expect(showToast).toHaveBeenCalledWith("Save failed", "error");
  });

  it("does not persist auth failures for inline display", () => {
    expect(
      getPersistedFailureMessage(
        new AuthApiError("Authentication required", { status: 401 }),
        "Could not save.",
      ),
    ).toBe("");
    expect(
      getPersistedFailureMessage(new Error("Save failed"), "Could not save."),
    ).toBe("Save failed");
  });

  it("detects auth failure messages stored in cache", () => {
    expect(isAuthFailureMessage("Authentication required")).toBe(true);
    expect(isAuthFailureMessage(AUTH_SIGN_IN_AGAIN_MESSAGE)).toBe(true);
    expect(isAuthFailureMessage("Could not save.")).toBe(false);
  });

  it("shows only one auth toast until the page reloads", () => {
    const showToast = jest.fn();
    const authError = new AuthApiError("Authentication required", {
      status: 401,
    });

    showApiErrorToast(showToast, authError, "Could not save.");
    showApiErrorToast(showToast, authError, "Could not load teams.");

    expect(showToast).toHaveBeenCalledTimes(1);
  });
});
