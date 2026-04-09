import {
  getAuthBootstrapLoadingDescription,
  getFirebaseSignInMessage,
  getForgotPasswordErrorMessage,
  getSignInFlowErrorMessage,
  getSessionApiErrorMessage,
  getVerifyEmailCodeErrorMessage,
  isFirebaseAuthError,
} from "./authUserMessages";

describe("authUserMessages", () => {
  describe("isFirebaseAuthError", () => {
    it("returns true for Firebase auth error shape", () => {
      expect(isFirebaseAuthError({ code: "auth/invalid-credential" })).toBe(
        true,
      );
    });
    it("returns false for non-auth codes", () => {
      expect(isFirebaseAuthError({ code: "permission-denied" })).toBe(false);
    });
  });

  describe("getFirebaseSignInMessage", () => {
    it("maps known auth codes", () => {
      expect(
        getFirebaseSignInMessage({ code: "auth/too-many-requests" }),
      ).toContain("Too many");
    });
    it("returns default for unknown auth code", () => {
      expect(getFirebaseSignInMessage({ code: "auth/unknown-code" })).toContain(
        "Could not sign in",
      );
    });
  });

  describe("getSignInFlowErrorMessage", () => {
    it("uses Firebase mapping for auth errors", () => {
      expect(
        getSignInFlowErrorMessage({ code: "auth/invalid-credential" }),
      ).toContain("Could not sign in");
    });
    it("uses API mapping for session errors", () => {
      expect(getSignInFlowErrorMessage(new Error("Request failed"))).toContain(
        "finish signing in",
      );
    });
  });

  describe("getVerifyEmailCodeErrorMessage", () => {
    it("maps invalid code message", () => {
      expect(
        getVerifyEmailCodeErrorMessage(new Error("That code is not valid.")),
      ).toContain("does not match");
    });
  });

  describe("getSessionApiErrorMessage", () => {
    it("handles empty request failed", () => {
      expect(getSessionApiErrorMessage(new Error("Request failed"))).toContain(
        "finish signing in",
      );
    });
  });

  describe("getForgotPasswordErrorMessage", () => {
    it("maps email required", () => {
      expect(
        getForgotPasswordErrorMessage(new Error("Email is required.")),
      ).toContain("Enter your email");
    });
  });

  describe("getAuthBootstrapLoadingDescription", () => {
    it("describes connecting while checking", () => {
      expect(getAuthBootstrapLoadingDescription("checking")).toBe(
        "Connecting to WorshipSync…",
      );
    });
    it("describes finishing when server responded", () => {
      expect(getAuthBootstrapLoadingDescription("online")).toContain(
        "WorshipSync",
      );
    });
    it("describes offline without retries", () => {
      expect(getAuthBootstrapLoadingDescription("offline")).toContain(
        "WorshipSync",
      );
    });
    it("includes attempt when offline with retries", () => {
      expect(
        getAuthBootstrapLoadingDescription("offline", { retryCount: 2 }),
      ).toContain("attempt 2");
    });
  });
});
