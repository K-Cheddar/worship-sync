import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import AuthScreenMain from "../components/AuthScreenMain";

const CanvaConnectComplete = () => {
  const location = useLocation();
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const successful = params.get("status") === "success";
  const accountLabel = String(params.get("accountLabel") || "").trim();
  const fromDesktop = params.get("desktop") === "1";
  const fallbackError =
    "The Canva connection did not finish. Return to WorshipSync and try again.";

  return (
    <AuthScreenMain>
      <div className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6 text-center">
        <h1 className="text-2xl font-semibold">
          {successful
            ? accountLabel
              ? `Connected to ${accountLabel}`
              : "Canva connected"
            : "Canva connection problem"}
        </h1>
        <p
          className={`mt-3 text-sm leading-relaxed ${
            successful ? "text-gray-200" : "text-amber-200"
          }`}
        >
          {successful
            ? `Return to the WorshipSync${fromDesktop ? " desktop app" : ""}. You can close this browser tab.`
            : params.get("message") || fallbackError}
        </p>
      </div>
    </AuthScreenMain>
  );
};

export default CanvaConnectComplete;
