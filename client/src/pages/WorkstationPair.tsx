import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import AuthScreenMain from "../components/AuthScreenMain";
import SetupScreenBackButton from "../components/SetupScreenBackButton";
import { exchangeDevicePairingRequest, getDevicePairingRequestStatus, redeemDisplayPairing, redeemWorkstationPairing, startDevicePairingRequest } from "../api/auth";
import { clearDisplayToken, clearWorkstationToken, setDisplayToken, setWorkstationToken } from "../utils/authStorage";
import { getDisplayPairingDestination } from "../utils/displaySurface";
import { isElectron } from "../utils/environment";
import { getPairingCodeErrorMessage } from "../utils/authUserMessages";
import { GlobalInfoContext } from "../context/globalInfo";
import type { DevicePairingRequestStartResponse, RedeemDisplayPairingResponse, RedeemWorkstationPairingResponse } from "../api/authTypes";

const WorkstationPair = ({ lockedPairType }: { lockedPairType: "workstation" | "display" }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const context = useContext(GlobalInfoContext);
  const tokenFromQuery = useMemo(() => String(searchParams.get("token") || "").trim(), [searchParams]);
  const [pairingCode, setPairingCode] = useState(tokenFromQuery);
  const [codeFieldError, setCodeFieldError] = useState("");
  const [bannerError, setBannerError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [request, setRequest] = useState<DevicePairingRequestStartResponse | null>(null);
  const [qrError, setQrError] = useState("");
  const [showManual, setShowManual] = useState(false);
  const lastAutoPairTokenRef = useRef("");
  const pollInFlightRef = useRef(false);
  const qrExchangeInFlightRef = useRef(false);
  const qrExchangeFailedRequestIdRef = useRef("");
  const returnPath = typeof location.state === "object" && location.state && "from" in location.state && typeof (location.state as { from?: { pathname?: string } }).from?.pathname === "string" ? (location.state as { from: { pathname: string } }).from.pathname : "";
  const deviceName = lockedPairType === "display" ? "display" : "workstation";

  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") navigate("/"); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [navigate]);
  useEffect(() => { setPairingCode(tokenFromQuery); }, [tokenFromQuery]);

  const finishPairing = useCallback(async (response: RedeemWorkstationPairingResponse | RedeemDisplayPairingResponse) => {
    if (lockedPairType === "display") {
      const displayResponse = response as RedeemDisplayPairingResponse;
      clearWorkstationToken(); setDisplayToken(displayResponse.credential); await context?.refreshAuthBootstrap();
      navigate(getDisplayPairingDestination(returnPath, displayResponse.device?.surfaceType, displayResponse.device?.outputId), { replace: true });
    } else {
      const workstationResponse = response as RedeemWorkstationPairingResponse;
      clearDisplayToken();
      if (workstationResponse.credential) setWorkstationToken(workstationResponse.credential); else clearWorkstationToken();
      await context?.refreshAuthBootstrap(); navigate(returnPath || "/workstation/operator", { replace: true });
    }
  }, [context, lockedPairType, navigate, returnPath]);

  const handlePair = useCallback(async (codeOverride?: string) => {
    const codeToUse = String(codeOverride || pairingCode).trim();
    if (!codeToUse) { setBannerError(""); setCodeFieldError("Enter the link code to continue"); return; }
    setIsLoading(true); setCodeFieldError(""); setBannerError("");
    try {
      if (lockedPairType === "display") {
        const response = await redeemDisplayPairing({ token: codeToUse });
        await finishPairing(response);
      } else {
        const response = await redeemWorkstationPairing({ token: codeToUse, platformType: isElectron() ? "electron" : "web" });
        await finishPairing(response);
      }
    } catch (error) { setBannerError(getPairingCodeErrorMessage(error)); } finally { setIsLoading(false); }
  }, [finishPairing, lockedPairType, pairingCode]);

  const exchangeQrRequest = useCallback(async (pairingRequest: DevicePairingRequestStartResponse) => {
    if (qrExchangeInFlightRef.current) return;
    qrExchangeInFlightRef.current = true;
    setQrError(""); setIsLoading(true);
    try {
      const response = await exchangeDevicePairingRequest({ requestId: pairingRequest.requestId, requestSecret: pairingRequest.requestSecret, ...(lockedPairType === "workstation" ? { platformType: isElectron() ? "electron" : "web" } : {}) });
      await finishPairing(response);
    } catch (error) {
      qrExchangeFailedRequestIdRef.current = pairingRequest.requestId;
      setQrError(getPairingCodeErrorMessage(error));
    } finally {
      qrExchangeInFlightRef.current = false; setIsLoading(false);
    }
  }, [finishPairing, lockedPairType]);

  const startRequest = useCallback(async () => {
    setQrError(""); setRequest(null); qrExchangeFailedRequestIdRef.current = "";
    try {
      const response = await startDevicePairingRequest({ kind: lockedPairType, ...(lockedPairType === "workstation" ? { platformType: isElectron() ? "electron" : "web" } : {}) });
      setRequest(response);
    } catch { setQrError("Could not generate a QR code. Check the connection and try again."); }
  }, [lockedPairType]);

  useEffect(() => { if (!tokenFromQuery) void startRequest(); }, [startRequest, tokenFromQuery]);
  useEffect(() => { if (!tokenFromQuery || isLoading || lastAutoPairTokenRef.current === tokenFromQuery) return; lastAutoPairTokenRef.current = tokenFromQuery; void handlePair(tokenFromQuery); }, [handlePair, isLoading, tokenFromQuery]);
  useEffect(() => {
    if (!request) return;
    let active = true;
    const poll = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const status = await getDevicePairingRequestStatus({ requestId: request.requestId, requestSecret: request.requestSecret });
        if (!active) return;
        if (status.status === "awaiting_exchange" && qrExchangeFailedRequestIdRef.current !== request.requestId) void exchangeQrRequest(request);
        else if (status.status === "expired" || status.status === "failed") { setRequest(null); setQrError(status.status === "expired" ? "This QR code expired. Generate a new one." : "This pairing request failed. Generate a new QR code."); }
      } catch { /* transient polling failures leave the valid request visible */ } finally { pollInFlightRef.current = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), Math.max(1000, request.pollIntervalMs || 1500));
    return () => { active = false; window.clearInterval(timer); };
  }, [exchangeQrRequest, request]);

  return <AuthScreenMain><div className="w-full max-w-md rounded-2xl border border-gray-500 bg-gray-800 p-6"><SetupScreenBackButton />
    <h1 className="text-2xl font-semibold">Link this {deviceName}</h1>
    {tokenFromQuery ? <p className="mt-3 text-sm text-cyan-300">Device link detected. We&apos;ll try to connect this device automatically.</p> : <>
      <p className="mt-2 text-sm text-gray-200">Scan this QR code with a phone signed in to WorshipSync as an administrator.</p>
      {(request || !qrError) ? <div data-testid="device-pairing-qr-surface" className="mt-5 flex justify-center rounded-xl bg-white p-6" style={{ backgroundColor: "#FFFFFF", colorScheme: "light", forcedColorAdjust: "none" }}>{request ? <QRCode data-testid="device-pairing-qr-code" value={request.approvalUrl} size={280} bgColor="#FFFFFF" fgColor="#000000" /> : <span className="text-sm text-gray-700">Preparing QR code…</span>}</div> : null}
      {request && !qrError ? <p className="mt-4 text-center text-sm text-cyan-300" role="status">Waiting for approval…</p> : null}
      {qrError ? <div className="mt-4 text-center"><p className="text-sm text-red-400" role="alert">{qrError}</p><Button className="mt-3" onClick={() => void startRequest()}>Generate new QR</Button></div> : null}
      {request && qrExchangeFailedRequestIdRef.current === request.requestId ? <div className="mt-3 flex justify-center gap-2"><Button onClick={() => { qrExchangeFailedRequestIdRef.current = ""; void exchangeQrRequest(request); }}>Retry</Button><Button variant="secondary" onClick={() => void startRequest()}>Generate new QR</Button></div> : null}
      <div className="my-6 flex items-center gap-3 text-xs text-gray-400"><span className="h-px flex-1 bg-gray-600" />or<span className="h-px flex-1 bg-gray-600" /></div>
      <Button className="w-full justify-center" variant="secondary" onClick={() => setShowManual((shown) => !shown)}>Use a link code instead</Button>
    </>}
    {(showManual || tokenFromQuery) ? <div className="mt-5 rounded-xl border border-gray-600/90 bg-gray-900/35 p-4">{bannerError ? <p className="mb-3 text-sm text-red-400" role="alert">{bannerError}</p> : null}<Input className="mt-0" id="device-link-code" label="Link code" value={pairingCode} errorText={codeFieldError} onChange={(value) => { setPairingCode(String(value)); setCodeFieldError(""); setBannerError(""); }} autoComplete="off" /><div className="mt-4 flex flex-col gap-2 sm:flex-row"><Button className="flex-1 justify-center" variant="cta" onClick={() => void handlePair()} isLoading={isLoading} disabled={isLoading}>Link device</Button><Button className="flex-1 justify-center" onClick={() => navigate("/")} disabled={isLoading}>Cancel</Button></div></div> : null}
  </div></AuthScreenMain>;
};
export default WorkstationPair;
