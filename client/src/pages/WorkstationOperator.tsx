import { type FormEvent, useContext, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import { GlobalInfoContext } from "../context/globalInfo";
import { getWorkstationToken } from "../utils/authStorage";
import { updateWorkstationOperator } from "../api/auth";

const WorkstationOperator = () => {
  const navigate = useNavigate();
  const context = useContext(GlobalInfoContext);
  const [operatorName, setOperatorName] = useState(context?.operatorName || "");
  const [nameFieldError, setNameFieldError] = useState("");
  const [bannerError, setBannerError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (context?.operatorName) {
      setOperatorName(context.operatorName);
    }
  }, [context?.operatorName]);

  const deviceId = context?.device?.deviceId;
  const bootstrapStatus = context?.bootstrapStatus;
  const loginState = context?.loginState;

  if (
    !context ||
    bootstrapStatus === "loading" ||
    loginState === "loading"
  ) {
    return (
      <div className="flex min-h-dvh w-full items-center justify-center bg-gray-700 px-6 text-white">
        <div className="max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-8 text-center">
          <h1 className="text-2xl font-semibold">Preparing this workstation...</h1>
          <p className="mt-3 text-sm text-gray-200">
            Please wait while WorshipSync validates this session.
          </p>
        </div>
      </div>
    );
  }

  if (context.sessionKind !== "workstation" || !deviceId) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleContinue();
  };

  const handleContinue = async () => {
    if (!operatorName.trim()) {
      setBannerError("");
      setNameFieldError("Enter the operator name to continue");
      return;
    }
    setNameFieldError("");
    setBannerError("");
    setIsSaving(true);
    try {
      const token = getWorkstationToken();
      await updateWorkstationOperator(
        deviceId,
        operatorName.trim(),
        token
      );
      context?.setOperatorName(operatorName.trim());
      navigate("/controller", { replace: true });
    } catch (error) {
      setBannerError(
        error instanceof Error ? error.message : "Could not save the operator name"
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-700 px-4 text-white">
      <form
        className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6"
        onSubmit={handleSubmit}
        noValidate
      >
        <h1 className="text-2xl font-semibold">Who's operating today?</h1>
        <p className="mt-2 text-sm text-gray-200">
          This name helps the team know who is running this shared workstation.
        </p>
        {bannerError && (
          <p className="mt-4 text-sm text-red-400" role="alert">
            {bannerError}
          </p>
        )}
        <Input
          className="mt-4"
          id="operator-name"
          label="Operator Name"
          value={operatorName}
          required
          errorText={nameFieldError}
          onChange={(value) => {
            setOperatorName(String(value));
            if (nameFieldError) setNameFieldError("");
            if (bannerError) setBannerError("");
          }}
        />
        <div className="mt-4 flex gap-2">
          <Button
            className="flex-1 justify-center"
            type="submit"
            variant="cta"
            isLoading={isSaving}
            disabled={isSaving}
          >
            Continue
          </Button>
          <Button
            className="flex-1 justify-center"
            type="button"
            onClick={() => navigate("/")}
            disabled={isSaving}
          >
            Cancel
          </Button>
        </div>
      </form>
    </main>
  );
};

export default WorkstationOperator;
