import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { AuthHandoffMarks } from "../components/AuthHandoffMarks";
import AuthScreenMain from "../components/AuthScreenMain";

const YouTubeConnectComplete = () => {
  const location = useLocation();
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );

  const status = String(params.get("status") || "").trim().toLowerCase();
  const accountLabel = String(params.get("accountLabel") || "").trim();
  const message = String(params.get("message") || "").trim();
  const fromDesktop =
    params.get("desktop") === "1" ||
    String(params.get("desktop") || "").toLowerCase() === "true";

  const wasSuccessful = status === "success";
  let title = "YouTube connection problem";
  if (wasSuccessful) {
    title = accountLabel ? `Connected to ${accountLabel}` : "YouTube connected";
  }

  let detail =
    message ||
    "The YouTube connection did not finish. Return to WorshipSync and try again.";
  if (wasSuccessful && fromDesktop) {
    detail =
      "Return to the WorshipSync desktop app. You can close this browser tab.";
  } else if (wasSuccessful) {
    detail = "Return to WorshipSync. You can close this browser tab.";
  } else if (fromDesktop) {
    detail =
      message ||
      "The YouTube connection did not finish. Return to the WorshipSync desktop app and try again.";
  }

  return (
    <AuthScreenMain>
      <div className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6 text-center">
        <AuthHandoffMarks provider="youtube" />
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p
          className={`mt-3 text-sm leading-relaxed ${wasSuccessful ? "text-gray-200" : "text-amber-200"
            }`}
        >
          {detail}
        </p>
      </div>
    </AuthScreenMain>
  );
};

export default YouTubeConnectComplete;
