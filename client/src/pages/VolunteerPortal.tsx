import { useEffect, useMemo, useRef, useState } from "react";
import { openVolunteerSession, personalScheduleAccess, volunteerRequest, volunteerRequestKey, VolunteerApiError, type VolunteerSession } from "../api/volunteer";
import Button from "../components/Button/Button";
import Input from "../components/Input/Input";
import { readVolunteerIngress, clearVolunteerIngress } from "../public/volunteerIngress";
import MySchedule from "./MySchedule";

const VolunteerPortal = () => {
  const [session, setSession] = useState<VolunteerSession | null>(null);
  const [status, setStatus] = useState("loading");
  const [contact, setContact] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const requestKey = useRef("");
  const completionKey = useRef("");
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void openVolunteerSession().then((value) => { if (active) { setSession(value); setStatus("ready"); } }).catch((error: unknown) => {
      if (!active) return;
      const accessStatus = error instanceof VolunteerApiError ? error.details.accessStatus : "";
      if (accessStatus === "invalid" || accessStatus === "revoked" || accessStatus === "expired") {
        setStatus(accessStatus);
      } else {
        setStatus("error");
      }
    });
    return () => { active = false; mounted.current = false; controller.current?.abort(); };
  }, [retry]);
  useEffect(() => {
    if (!challengeId) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [challengeId]);
  const access = useMemo(() => session ? personalScheduleAccess(session) : null, [session]);
  const start = async (resend = false) => {
    if (pending) return;
    if (resend || !requestKey.current) requestKey.current = volunteerRequestKey();
    controller.current = new AbortController();
    setPending(true); setMessage("");
    try {
      const result = await volunteerRequest<{ challengeId: string }>("recovery/start", {
        token: readVolunteerIngress(), contact, requestKey: requestKey.current,
      }, "", controller.current.signal);
      if (!mounted.current) return;
      completionKey.current = volunteerRequestKey();
      setChallengeId(result.challengeId); setCooldown(60);
      setMessage("If verification is available, a code has been sent. If no code arrives, contact your church administrator.");
    } catch { if (mounted.current) setMessage("Could not request a code. Try again in a moment."); }
    finally { if (mounted.current) setPending(false); }
  };
  const verify = async () => {
    if (pending) return;
    controller.current = new AbortController();
    setPending(true); setMessage("");
    try {
      await volunteerRequest("recovery/verify", { challengeId, code, completionKey: completionKey.current }, "", controller.current.signal);
      if (!mounted.current) return;
      clearVolunteerIngress(); setStatus("loading"); setRetry((value) => value + 1);
    } catch { if (mounted.current) setMessage("Could not verify this code. Try again or request a new code."); }
    finally { if (mounted.current) setPending(false); }
  };
  if (access) return <MySchedule access={access} />;
  return <main className="flex h-dvh items-center justify-center overflow-y-auto bg-neutral-950 px-4 text-white">
    <div className="flex w-full max-w-md flex-col gap-4 py-8">
      <h1 className="text-xl font-semibold">My Schedule</h1>
      {status === "loading" ? <p role="status">Opening your schedule…</p> : <>
        {status === "error" ? <><p role="alert">Could not open My Schedule. Try again in a moment.</p><Button onClick={() => { setStatus("loading"); setRetry((value) => value + 1); }}>Retry opening My Schedule</Button></> : null}
        {status === "revoked" ? <p>Personal access has been turned off. Contact your church administrator.</p> : status !== "error" ? <>
          <p>{status === "expired" ? "Verify your identity to open your schedule." : "Open your personal link, or verify your contact information to recover access."}</p>
          {!readVolunteerIngress() ? <Input label="Email or mobile number" value={contact} onChange={(value) => { setContact(String(value)); requestKey.current = ""; }} /> : null}
          {challengeId ? <>
            <Input label="Verification code" value={code} onChange={(value) => setCode(String(value))} />
            <Button disabled={pending || !code} onClick={() => void verify()}>{pending ? "Verifying…" : "Verify and open My Schedule"}</Button>
            <Button variant="secondary" disabled={pending || cooldown > 0} onClick={() => void start(true)}>
              {cooldown > 0 ? `Request another code in ${cooldown}s` : "Request another code"}
            </Button>
          </> : <Button disabled={pending || (!readVolunteerIngress() && !contact.trim())} onClick={() => void start()}>{pending ? "Requesting code…" : "Verify identity"}</Button>}
        </> : null}
        {message ? <p role="status" className="text-sm text-gray-300">{message}</p> : null}
        <p className="text-sm text-gray-400">If your contact information has not been verified, contact your church administrator.</p>
      </>}
    </div>
  </main>;
};
export default VolunteerPortal;
