import { useEffect, useMemo, useState, type FormEvent } from "react";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { Eye, EyeOff } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import { getHumanAuth } from "../firebase/apps";
import { isFirebaseAuthError } from "../utils/authUserMessages";
import {
  FIREBASE_PASSWORD_MIN_LENGTH,
  firebasePasswordRequirementsHint,
} from "../utils/passwordRequirements";

const REDIRECT_DELAY_SEC = 6;

const getPasswordResetErrorMessage = (error: unknown) => {
  if (isFirebaseAuthError(error) && error.code === "auth/weak-password") {
    return `Password must be at least ${FIREBASE_PASSWORD_MIN_LENGTH} characters. Add a mix of letters, numbers, or symbols.`;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Could not reset the password";
};

const PasswordReset = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const oobCode = useMemo(() => searchParams.get("oobCode") || "", [searchParams]);
  const [password, setPassword] = useState("");
  const [passwordFieldError, setPasswordFieldError] = useState("");
  const [bannerError, setBannerError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [redirectSecondsRemaining, setRedirectSecondsRemaining] = useState<
    number | null
  >(null);

  useEffect(() => {
    if (redirectSecondsRemaining === null) {
      return;
    }
    if (redirectSecondsRemaining < 1) {
      return;
    }

    const id = window.setTimeout(() => {
      setRedirectSecondsRemaining((s) => {
        if (s === null) {
          return null;
        }
        if (s <= 1) {
          navigate("/login");
          return null;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearTimeout(id);
  }, [redirectSecondsRemaining, navigate]);

  const goToSignInNow = () => {
    navigate("/login");
    setRedirectSecondsRemaining(null);
  };

  const validatePassword = () => {
    if (!password) {
      setPasswordFieldError("Enter your password.");
      return false;
    }
    if (password.length < FIREBASE_PASSWORD_MIN_LENGTH) {
      setPasswordFieldError(
        `Use at least ${FIREBASE_PASSWORD_MIN_LENGTH} characters.`
      );
      return false;
    }
    return true;
  };

  const handleReset = async () => {
    if (!oobCode) {
      setPasswordFieldError("");
      setBannerError("This reset link is missing its code.");
      return;
    }
    setBannerError("");
    if (!validatePassword()) {
      return;
    }

    setIsSaving(true);
    setPasswordFieldError("");
    setBannerError("");

    try {
      const auth = getHumanAuth();
      await verifyPasswordResetCode(auth, oobCode);
      await confirmPasswordReset(auth, oobCode, password);
      setPassword("");
      setShowPassword(false);
      setRedirectSecondsRemaining(REDIRECT_DELAY_SEC);
    } catch (error) {
      setBannerError(getPasswordResetErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) {
      return;
    }
    void handleReset();
  };

  const isPostSuccess = redirectSecondsRemaining !== null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-700 px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6">
        <h1 className="text-2xl font-semibold">Reset password</h1>
        {!isPostSuccess ? (
          <p className="mt-2 text-sm text-gray-200">
            Choose a new password for your WorshipSync account.
          </p>
        ) : null}

        {!isPostSuccess && bannerError ? (
          <p className="mt-4 text-sm text-red-400" role="alert">
            {bannerError}
          </p>
        ) : null}

        {isPostSuccess ? (
          <div className="mt-4 flex flex-col gap-4">
            <p className="text-sm text-cyan-300" role="status" aria-live="polite">
              Password updated. Redirecting to sign in in {redirectSecondsRemaining}{" "}
              {redirectSecondsRemaining === 1 ? "second" : "seconds"}.
            </p>
            <Button
              type="button"
              variant="cta"
              className="w-full justify-center"
              onClick={goToSignInNow}
            >
              Sign in now
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col"
            onSubmit={handleFormSubmit}
            noValidate
          >
            <Input
              className="mt-4"
              id="reset-password"
              label="New Password"
              type={showPassword ? "text" : "password"}
              value={password}
              errorText={passwordFieldError}
              onChange={(value) => {
                setPassword(String(value));
                if (passwordFieldError) setPasswordFieldError("");
                if (bannerError) setBannerError("");
              }}
              svg={showPassword ? EyeOff : Eye}
              svgAction={() => setShowPassword((current) => !current)}
              svgActionAriaLabel={showPassword ? "Hide password" : "Show password"}
              autoComplete="new-password"
              disabled={isSaving}
            />
            <p className="mt-2 text-xs leading-relaxed text-gray-400">
              {firebasePasswordRequirementsHint}
            </p>

            <div className="mt-6 flex flex-col gap-2">
              <Button
                type="submit"
                variant="cta"
                className="w-full justify-center"
                isLoading={isSaving}
                disabled={isSaving}
              >
                Reset Password
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
};

export default PasswordReset;
