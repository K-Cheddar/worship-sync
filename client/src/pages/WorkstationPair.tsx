import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import SetupScreenBackButton from "../components/SetupScreenBackButton";
import { redeemDisplayPairing, redeemWorkstationPairing } from "../api/auth";
import {
  clearWorkstationToken,
  setDisplayToken,
  setWorkstationToken,
} from "../utils/authStorage";
import { getDisplayPairingDestination } from "../utils/displaySurface";
import { isElectron } from "../utils/environment";
import { GlobalInfoContext } from "../context/globalInfo";

const roleDescription = (pairType: "workstation" | "display") =>
  pairType === "workstation"
    ? "This setup code is for a shared controller (workstation)."
    : "This setup code is for a projector, monitor, or stream output.";

const WorkstationPair = ({
  lockedPairType,
}: {
  lockedPairType: "workstation" | "display";
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const context = useContext(GlobalInfoContext);
  const tokenFromQuery = useMemo(
    () => String(searchParams.get("token") || "").trim(),
    [searchParams]
  );
  const [pairingCode, setPairingCode] = useState(tokenFromQuery);
  const [codeFieldError, setCodeFieldError] = useState("");
  const [bannerError, setBannerError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const lastAutoPairTokenRef = useRef("");
  const returnPath =
    typeof location.state === "object" &&
    location.state &&
    "from" in location.state &&
    typeof (location.state as { from?: { pathname?: string } }).from?.pathname ===
      "string"
      ? (location.state as { from: { pathname: string } }).from.pathname
      : "";

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      navigate("/");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  useEffect(() => {
    setPairingCode(tokenFromQuery);
  }, [tokenFromQuery]);

  const handlePair = useCallback(
    async (codeOverride?: string) => {
      const codeToUse = String(codeOverride || pairingCode).trim();
      if (!codeToUse) {
        setBannerError("");
        setCodeFieldError("Enter the setup code to continue");
        return;
      }

      setIsLoading(true);
      setCodeFieldError("");
      setBannerError("");

      try {
        if (lockedPairType === "display") {
          const response = await redeemDisplayPairing({
            token: codeToUse,
          });
          setDisplayToken(response.credential);
          await context?.refreshAuthBootstrap();
          navigate(
            getDisplayPairingDestination(
              returnPath,
              response.device?.surfaceType,
            ),
            { replace: true },
          );
        } else {
          const response = await redeemWorkstationPairing({
            token: codeToUse,
            platformType: isElectron() ? "electron" : "web",
          });
          if (response.credential) {
            setWorkstationToken(response.credential);
            await context?.refreshAuthBootstrap();
          } else {
            clearWorkstationToken();
            await context?.refreshAuthBootstrap();
          }
          navigate(returnPath || "/workstation/operator", { replace: true });
        }
      } catch (error) {
        setBannerError(
          error instanceof Error ? error.message : "Could not set up this device"
        );
      } finally {
        setIsLoading(false);
      }
    },
    [context, lockedPairType, navigate, pairingCode, returnPath]
  );

  useEffect(() => {
    if (!tokenFromQuery || isLoading || lastAutoPairTokenRef.current === tokenFromQuery) {
      return;
    }
    lastAutoPairTokenRef.current = tokenFromQuery;
    void handlePair(tokenFromQuery);
  }, [handlePair, isLoading, tokenFromQuery]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-700 px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6">
        <SetupScreenBackButton />
        <h1 className="text-2xl font-semibold">Set up this device</h1>
        <p className="mt-2 text-sm text-gray-200">
          Enter the setup code from WorshipSync account settings to connect this device
          to your church.
        </p>
        <p
          className="mt-3 rounded-lg border border-gray-600/80 bg-gray-900/50 px-3 py-2 text-sm text-gray-300"
          role="status"
        >
          {roleDescription(lockedPairType)}
        </p>
        {tokenFromQuery && (
          <p className="mt-3 text-sm text-cyan-300">
            Setup link detected. We&apos;ll try to connect this device automatically.
          </p>
        )}

        {bannerError && (
          <p className="mt-4 text-sm text-red-400" role="alert">
            {bannerError}
          </p>
        )}

        <div className="mt-6 rounded-xl border border-gray-600/90 bg-gray-900/35 p-4 shadow-inner">
          <Input
            className="mt-0"
            id="setup-code"
            label="Setup code"
            value={pairingCode}
            errorText={codeFieldError}
            onChange={(value) => {
              setPairingCode(String(value));
              if (codeFieldError) setCodeFieldError("");
              if (bannerError) setBannerError("");
            }}
            autoComplete="off"
          />

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              className="flex-1 justify-center"
              variant="cta"
              onClick={() => void handlePair()}
              isLoading={isLoading}
              disabled={isLoading}
            >
              Finish setup
            </Button>
            <Button
              className="flex-1 justify-center"
              onClick={() => navigate("/")}
              disabled={isLoading}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
};

export default WorkstationPair;
