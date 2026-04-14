import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Button from "../components/Button/Button";
import { confirmRecoveryRequest } from "../api/auth";

const RecoveryConfirm = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleApprove = async () => {
    if (!token) {
      setErrorMessage("This recovery link is missing its token.");
      return;
    }
    setIsSaving(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      await confirmRecoveryRequest(token);
      setStatusMessage("Admin access restored for this church.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not approve recovery"
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-homepage-canvas px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6">
        <h1 className="text-2xl font-semibold">Approve admin recovery</h1>
        <p className="mt-2 text-sm text-gray-200">
          Confirm this request to restore admin access for the requesting member.
        </p>

        {statusMessage && (
          <p className="mt-4 text-sm text-cyan-300">{statusMessage}</p>
        )}
        {errorMessage && (
          <p className="mt-4 text-sm text-red-400">{errorMessage}</p>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="cta"
            className="w-full justify-center"
            onClick={() => void handleApprove()}
            isLoading={isSaving}
            disabled={isSaving}
          >
            Approve recovery
          </Button>
          <Button className="w-full justify-center" onClick={() => navigate("/")}>
            Home
          </Button>
        </div>
      </div>
    </main>
  );
};

export default RecoveryConfirm;
