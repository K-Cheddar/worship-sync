import { type FormEvent, useContext, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import AuthScreenMain from "../components/AuthScreenMain";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import WorkstationUnpairConfirmModal, {
  WORKSTATION_UNLINK_TRIGGER_LABEL,
} from "../components/WorkstationUnpairConfirmModal/WorkstationUnpairConfirmModal";
import { GlobalInfoContext } from "../context/globalInfo";
import { getWorkstationToken } from "../utils/authStorage";
import { updateWorkstationOperator } from "../api/auth";

const WorkstationOperator = () => {
  const navigate = useNavigate();
  const context = useContext(GlobalInfoContext);
  const [operatorName, setOperatorName] = useState("");
  const [nameFieldError, setNameFieldError] = useState("");
  const [bannerError, setBannerError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [unlinkModalOpen, setUnlinkModalOpen] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const deviceId = context?.device?.deviceId;
  const deviceLabel = context?.device?.label?.trim() ?? "";
  const churchName = context?.churchName?.trim() ?? "";
  const bootstrapStatus = context?.bootstrapStatus;
  const loginState = context?.loginState;
  const unlinkCurrentWorkstation = context?.unlinkCurrentWorkstation;

  if (
    !context ||
    bootstrapStatus === "loading" ||
    loginState === "loading"
  ) {
    return (
      <AuthScreenMain>
        <div className="max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-8 text-center">
          <h1 className="text-2xl font-semibold">Preparing this workstation...</h1>
          <p className="mt-3 text-sm text-gray-200">
            Please wait while WorshipSync validates this session.
          </p>
        </div>
      </AuthScreenMain>
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
    <AuthScreenMain>
      <form
        className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6"
        onSubmit={handleSubmit}
        noValidate
      >
        <h1 className="text-2xl font-semibold">Who's operating today?</h1>
        <p className="mt-2 text-sm text-gray-200">
          This name helps the team know who is running this shared workstation.
        </p>
        {churchName ? (
          <p className="mt-2 text-sm text-cyan-200/90">
            Church: <span className="font-medium text-white">{churchName}</span>
            {deviceLabel ? (
              <>
                {" "}
                · Device: <span className="font-medium text-white">{deviceLabel}</span>
              </>
            ) : null}
          </p>
        ) : null}
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
            type="button"
            onClick={() => navigate("/")}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 justify-center"
            type="submit"
            variant="cta"
            isLoading={isSaving}
            disabled={isSaving}
          >
            Continue
          </Button>
        </div>
        {unlinkCurrentWorkstation ? (
          <div className="mt-6 border-t border-gray-600 pt-4">
            <p className="text-xs text-gray-400">
              Only unlink if this computer should no longer be a shared workstation for your
              church.
            </p>
            <Button
              type="button"
              variant="tertiary"
              className="mt-3 w-full justify-center text-sm"
              disabled={isSaving}
              onClick={() => setUnlinkModalOpen(true)}
            >
              {WORKSTATION_UNLINK_TRIGGER_LABEL}
            </Button>
            <WorkstationUnpairConfirmModal
              isOpen={unlinkModalOpen}
              onClose={() => setUnlinkModalOpen(false)}
              isConfirming={unlinking}
              onConfirm={async () => {
                if (!unlinkCurrentWorkstation) return;
                setUnlinking(true);
                try {
                  await unlinkCurrentWorkstation();
                  setUnlinkModalOpen(false);
                } finally {
                  setUnlinking(false);
                }
              }}
            />
          </div>
        ) : null}
      </form>
    </AuthScreenMain>
  );
};

export default WorkstationOperator;
