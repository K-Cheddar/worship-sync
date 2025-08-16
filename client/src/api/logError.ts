type ErrorLogData = {
  error: Error;
  errorInfo: React.ErrorInfo;
  componentStack?: string | null;
  userAgent?: string;
  url?: string;
  timestamp: number;
};

type LogErrorResponse = {
  success: boolean;
  message?: string;
  errorMessage?: string;
  timestamp?: string;
};

export const logErrorToServer = async (
  errorData: ErrorLogData
): Promise<LogErrorResponse> => {
  try {
    const response = await fetch(
      `${process.env.REACT_APP_API_BASE_PATH}api/logError`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...errorData,
          userAgent: navigator.userAgent,
          url: window.location.href,
          timestamp: Date.now(),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data as LogErrorResponse;
  } catch (error) {
    console.error("Failed to log error to server:", error);
    // Don't throw here - we don't want error logging to cause additional errors
    return {
      success: false,
      errorMessage: "Failed to log error to server",
    };
  }
};
