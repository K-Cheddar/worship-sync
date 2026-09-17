import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AuthScreenMain from "../components/AuthScreenMain";
import Button from "../components/Button/Button";
import Checkbox from "../components/Checkbox/Checkbox";
import Input from "../components/Input/Input";
import Select from "../components/Select/Select";
import { approveDevicePairingRequest, getDevicePairingRequest } from "../api/auth";
import type { DevicePairingRequestPreview } from "../api/authTypes";
import { GlobalInfoContext } from "../context/globalInfo";
import { useSelector } from "../hooks";
import { selectDisplayOutputs } from "../store/displayOutputsSlice";
import {
  displaySurfaceOptions,
  workstationAccessOptions,
  type DisplaySurfaceOption,
  type WorkstationAccessOption,
} from "../utils/pairingOptions";

type DevicePairingApprovalProps = {
  requestId: string;
  onApproved?: () => void;
  onComplete?: () => void;
};

export const DevicePairingApproval = ({ requestId, onApproved, onComplete }: DevicePairingApprovalProps) => {
  const context = useContext(GlobalInfoContext);
  const [request, setRequest] = useState<DevicePairingRequestPreview | null>(null);
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [access, setAccess] = useState<WorkstationAccessOption>("full");
  const [serviceWorkspaceAccess, setServiceWorkspaceAccess] = useState(false);
  const [surfaceType, setSurfaceType] = useState<DisplaySurfaceOption>("projector");
  const [outputId, setOutputId] = useState("");
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const outputs = useSelector(selectDisplayOutputs);
  const outputOptions = useMemo(
    () => [
      { value: "", label: "Built-in for this page type" },
      ...outputs.filter((output) => output.enabled).map((output) => ({ value: output.id, label: output.name })),
    ],
    [outputs],
  );

  useEffect(() => {
    let active = true;
    setRequest(null);
    setError("");
    void getDevicePairingRequest(requestId)
      .then((response) => {
        if (active) setRequest(response.request);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load this device request.");
      });
    return () => {
      active = false;
    };
  }, [requestId]);

  const approve = useCallback(async () => {
    if (!request || !context?.churchId || !label.trim()) {
      setError("Enter a label before approving this device.");
      return;
    }
    setApproving(true);
    setError("");
    try {
      await approveDevicePairingRequest(
        context.churchId,
        request.requestId,
        request.kind === "workstation"
          ? { label: label.trim(), appAccess: access, serviceWorkspaceAccess }
          : { label: label.trim(), surfaceType, outputId: outputId || undefined },
      );
      if (onApproved) {
        onApproved();
      } else {
        setApproved(true);
      }
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Could not approve this device.");
    } finally {
      setApproving(false);
    }
  }, [access, context?.churchId, label, onApproved, outputId, request, serviceWorkspaceAccess, surfaceType]);

  if (approved) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Device approved</h1>
        <p className="mt-3 text-sm text-gray-200">
          The {request?.kind === "display" ? "display" : "workstation"} has been authorized and should connect automatically.
        </p>
        {onComplete && <Button className="mt-5" variant="cta" onClick={onComplete}>Back to administration</Button>}
      </div>
    );
  }

  return (
    <>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      {!request && !error && <p className="text-sm text-gray-200">Loading device request…</p>}
      {request && (
        <>
          {request.status !== "pending" ? (
            <p className="text-sm text-gray-200">
              This request is {request.status === "awaiting_exchange" ? "already approved" : request.status}.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-200">
                Configure this {request.kind}. {request.kind === "workstation" && request.platformType ? `It requested the ${request.platformType} app.` : ""}
              </p>
              <div className="mt-5 space-y-4">
                <Input id="device-pairing-label" label="Label" value={label} onChange={(value) => setLabel(String(value))} />
                {request.kind === "workstation" ? (
                  <>
                    <Select id="device-pairing-access" label="Access" value={access} options={workstationAccessOptions} onChange={(value) => setAccess(value as WorkstationAccessOption)} />
                    <Checkbox id="device-pairing-service-workspace" checked={serviceWorkspaceAccess} onCheckedChange={(value) => setServiceWorkspaceAccess(Boolean(value))} label="Service workspace" />
                  </>
                ) : (
                  <>
                    <Select id="device-pairing-surface" label="Page type" value={surfaceType} options={displaySurfaceOptions} onChange={(value) => setSurfaceType(value as DisplaySurfaceOption)} />
                    <Select id="device-pairing-output" label="Content output" value={outputId} options={outputOptions} onChange={setOutputId} />
                  </>
                )}
                <Button className="w-full justify-center" variant="cta" onClick={() => void approve()} isLoading={approving} disabled={approving}>
                  Approve {request.kind}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
};

const DevicePairingApprove = () => {
  const { requestId = "" } = useParams();
  const navigate = useNavigate();

  return (
    <AuthScreenMain>
      <div className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6">
        <h1 className="mb-4 text-2xl font-semibold">Approve device</h1>
        <DevicePairingApproval requestId={requestId} onComplete={() => navigate("/account/setup", { replace: true })} />
      </div>
    </AuthScreenMain>
  );
};

export default DevicePairingApprove;
