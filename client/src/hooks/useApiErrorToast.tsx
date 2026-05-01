import { useCallback } from "react";
import Button from "../components/Button/Button";
import { AuthApiError } from "../api/auth";
import { useToast } from "../context/toastContext";

export const useApiErrorToast = () => {
  const { showToast } = useToast();

  const showApiError = useCallback(
    (error: unknown, message: string) => {
      if (
        error instanceof AuthApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        showToast({
          message: "Authentication required — refresh the page to continue.",
          variant: "error",
          persist: true,
          children: () => (
            <div className="mt-2">
              <Button
                variant="cta"
                className="text-sm"
                onClick={() => window.location.reload()}
              >
                Refresh page
              </Button>
            </div>
          ),
        });
      } else {
        showToast(message, "error");
      }
    },
    [showToast],
  );

  return { showApiError };
};
