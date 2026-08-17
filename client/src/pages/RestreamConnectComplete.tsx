import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { AuthHandoffMarks } from "../components/AuthHandoffMarks";
import AuthScreenMain from "../components/AuthScreenMain";

const RestreamConnectComplete = () => {
  const location = useLocation();
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );

  const status = String(params.get("status") || "")
    .trim()
    .toLowerCase();
  const accountLabel = String(params.get("accountLabel") || "").trim();
  const message = String(params.get("message") || "").trim();

  const wasSuccessful = status === "success";
  let title = "Restream connection problem";
  if (wasSuccessful) {
    title = accountLabel
      ? `Connected to ${accountLabel}`
      : "Restream connected";
  }
  const detail = wasSuccessful
    ? "Return to WorshipSync. You can close this browser tab."
    : message ||
      "The Restream connection did not finish. Return to WorshipSync and try again.";

  return (
    <AuthScreenMain>
      <div className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6 text-center">
        <AuthHandoffMarks provider="restream" />
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p
          className={`mt-3 text-sm leading-relaxed ${
            wasSuccessful ? "text-gray-200" : "text-amber-200"
          }`}
        >
          {detail}
        </p>
      </div>
    </AuthScreenMain>
  );
};

export default RestreamConnectComplete;
