import {
  AUTH_DESKTOP_SIGN_IN_TIMED_OUT_MESSAGE,
  AUTH_EMAIL_CODE_EXPIRED_MESSAGE,
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
    it.each([
      ["password", "auth/invalid-credential", "that email and password"],
      ["password", "auth/invalid-login-credentials", "that email and password"],
      ["password", "auth/wrong-password", "that email and password"],
      ["password", "auth/user-not-found", "that email and password"],
      ["google", "auth/invalid-credential", "Google"],
      ["google", "auth/invalid-login-credentials", "Google"],
      ["google", "auth/wrong-password", "Google"],
      ["google", "auth/user-not-found", "Google"],
      ["microsoft", "auth/invalid-credential", "Microsoft"],
      ["microsoft", "auth/invalid-login-credentials", "Microsoft"],
      ["microsoft", "auth/wrong-password", "Microsoft"],
      ["microsoft", "auth/user-not-found", "Microsoft"],
    ] as const)("maps %s %s errors without changing method context", (method, code, expected) => {
      expect(getFirebaseSignInMessage({ code }, { method })).toContain(expected);
    });

    it.each([
      ["password", "Could not sign in with that email and password. Check your information and try again."],
      ["google", "Could not sign in with Google. Please try again."],
      ["microsoft", "Could not sign in with Microsoft. Please try again."],
    ] as const)("uses the %s fallback for unknown Firebase errors", (method, expected) => {
      expect(getFirebaseSignInMessage({ code: "auth/unknown-code" }, { method })).toBe(expected);
    });

    it("never gives password instructions for unknown Google or Microsoft errors", () => {
      for (const method of ["google", "microsoft"] as const) {
        const message = getFirebaseSignInMessage(
          { code: "auth/unknown-provider-error" },
          { method },
        );
        expect(message).not.toMatch(/email|password|password credentials/i);
      }
    });

    it("keeps invalid email specific to password sign-in", () => {
      expect(
        getFirebaseSignInMessage({ code: "auth/invalid-email" }, { method: "password" }),
      ).toContain("does not look valid");
      expect(
        getFirebaseSignInMessage({ code: "auth/invalid-email" }, { method: "google" }),
      ).toBe("Could not sign in with Google. Please try again.");
    });

    it.each([
      ["password", "Email and password sign-in"],
      ["google", "Google sign-in"],
      ["microsoft", "Microsoft sign-in"],
    ] as const)("maps operation-not-allowed for %s", (method, expected) => {
      expect(
        getFirebaseSignInMessage({ code: "auth/operation-not-allowed" }, { method }),
      ).toContain(expected);
    });

    it.each([
      ["google", "Google", "auth/popup-closed-by-user", "didn't finish"],
      ["microsoft", "Microsoft", "auth/cancelled-popup-request", "didn't finish"],
      ["google", "Google", "auth/popup-blocked", "blocked"],
      ["microsoft", "Microsoft", "auth/popup-blocked", "blocked"],
    ] as const)("maps %s %s as provider-specific popup feedback", (method, provider, code, expected) => {
      const message = getFirebaseSignInMessage({ code }, { method });
      expect(message).toContain(provider);
      expect(message).toContain(expected);
      expect(message).not.toMatch(/email|password/i);
    });

    it.each([
      ["password", "Could not reach the sign-in service"],
      ["google", "Could not reach the sign-in service"],
      ["microsoft", "Could not reach the sign-in service"],
    ] as const)("keeps network errors actionable for %s", (method, expected) => {
      expect(
        getFirebaseSignInMessage({ code: "auth/network-request-failed" }, { method }),
      ).toContain(expected);
    });

    it.each([
      ["password", "Too many sign-in attempts"],
      ["google", "Too many sign-in attempts"],
      ["microsoft", "Too many sign-in attempts"],
    ] as const)("keeps rate-limit errors actionable for %s", (method, expected) => {
      expect(
        getFirebaseSignInMessage({ code: "auth/too-many-requests" }, { method }),
      ).toContain(expected);
    });

    it.each(["password", "google", "microsoft"] as const)(
      "explains disabled accounts for %s",
      (method) => {
        expect(
          getFirebaseSignInMessage({ code: "auth/user-disabled" }, { method }),
        ).toContain("account is not available");
      },
    );

    it("maps Firebase error message strings without exposing their contents", () => {
      expect(
        getFirebaseSignInMessage(
          new Error("Firebase: secret internal detail (auth/some-new-error)."),
          { method: "microsoft" },
        ),
      ).toBe("Could not sign in with Microsoft. Please try again.");
    });
  });

  describe("getSignInFlowErrorMessage", () => {
    it("uses method-aware Firebase mapping for auth errors", () => {
      expect(
        getSignInFlowErrorMessage(
          { code: "auth/unknown-code" },
          { method: "microsoft" },
        ),
      ).toBe("Could not sign in with Microsoft. Please try again.");
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

    it("maps expired codes to a resend action", () => {
      expect(
        getVerifyEmailCodeErrorMessage(
          new Error("This code has expired. Request a new code to continue."),
        ),
      ).toBe(AUTH_EMAIL_CODE_EXPIRED_MESSAGE);
    });

    it("keeps locked and invalid sign-in states distinct from expiration", () => {
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
