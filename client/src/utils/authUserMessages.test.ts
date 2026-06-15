import {
  AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  AUTH_SIGN_IN_AGAIN_MESSAGE,
  getAuthBootstrapLoadingDescription,
  getDesktopSignInErrorMessage,
  getFirebaseSignInMessage,
  getForgotPasswordErrorMessage,
  getPairingCodeErrorMessage,
  getResendEmailCodeErrorMessage,
  getSignInFlowErrorMessage,
  getSessionApiErrorMessage,
  getVerifyEmailCodeErrorMessage,
  isFirebaseAuthError,
  PAIRING_CODE_EXPIRED_MESSAGE,
  PAIRING_CODE_INVALID_MESSAGE,
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

    it("maps expired and locked codes to sign in again", () => {
      expect(
        getVerifyEmailCodeErrorMessage(
          new Error("This sign-in code has expired. Try signing in again."),
        ),
      ).toBe(AUTH_SIGN_IN_AGAIN_MESSAGE);
      expect(
        getVerifyEmailCodeErrorMessage(
          new Error(
            "This sign-in code has been locked after too many attempts. Sign in again to get a new code.",
          ),
        ),
      ).toBe(AUTH_SIGN_IN_AGAIN_MESSAGE);
      expect(
        getVerifyEmailCodeErrorMessage(new Error("Please sign in again.")),
      ).toBe(AUTH_SIGN_IN_AGAIN_MESSAGE);
    });
  });

  describe("getResendEmailCodeErrorMessage", () => {
    it("maps identity token required to sign in again", () => {
      expect(
        getResendEmailCodeErrorMessage(
          new Error("Identity token is required."),
        ),
      ).toBe(AUTH_SIGN_IN_AGAIN_MESSAGE);
    });
  });

  describe("getDesktopSignInErrorMessage", () => {
    it("maps desktop handoff failures to timed out copy", () => {
      expect(
        getDesktopSignInErrorMessage(
          new Error(
            "This desktop sign-in confirmation expired. Return to your browser and try again.",
          ),
        ),
      ).toBe(AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE);
    });
  });

  describe("getPairingCodeErrorMessage", () => {
    it("maps inactive pairing codes", () => {
      expect(
        getPairingCodeErrorMessage(
          new Error("This workstation pairing code is not active."),
        ),
      ).toBe(PAIRING_CODE_INVALID_MESSAGE);
    });

    it("maps expired pairing codes", () => {
      expect(
        getPairingCodeErrorMessage(
          new Error("This display pairing code has expired."),
        ),
      ).toBe(PAIRING_CODE_EXPIRED_MESSAGE);
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
