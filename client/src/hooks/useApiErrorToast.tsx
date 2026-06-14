import { useCallback } from "react";
import { showApiErrorToast } from "../utils/apiErrorToast";
import { useToast } from "../context/toastContext";

export const useApiErrorToast = () => {
  const { showToast } = useToast();

  const showApiError = useCallback(
    (error: unknown, message: string) => {
      showApiErrorToast(showToast, error, message);
    },
    [showToast],
  );

  return { showApiError };
};
