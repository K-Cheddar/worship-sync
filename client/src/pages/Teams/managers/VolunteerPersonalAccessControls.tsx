import { useEffect, useRef, useState } from "react";
import { manageVolunteerPersonalAccess } from "../../../api/auth";
import { volunteerRequestKey } from "../../../api/volunteer";
import Button from "../../../components/Button/Button";
import Input from "../../../components/Input/Input";
import Select from "../../../components/Select/Select";
import { useToast } from "../../../context/toastContext";
import { showApiErrorToast } from "../../../utils/apiErrorToast";

const VolunteerPersonalAccessControls = ({ churchId, memberId }: { churchId: string; memberId: string }) => {
  const { showToast } = useToast();
  const [status, setStatus] = useState("");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [channel, setChannel] = useState("email");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  const busy = useRef(false);
  const requestKey = useRef("");
  const completionKey = useRef("");
  const replacementKey = useRef("");
  const replacementStorageKey = JSON.stringify(["worshipsync.pendingVolunteerReplacement", churchId, memberId]);
  useEffect(() => {
    mounted.current = true;
    void manageVolunteerPersonalAccess(churchId, memberId, "status").then((result) => {
      if (mounted.current && result.enabled) setStatus(result.status || "none");
    }).catch(() => {});
    return () => { mounted.current = false; };
  }, [churchId, memberId]);
  const act = async (action: Parameters<typeof manageVolunteerPersonalAccess>[2]) => {
    if (busy.current) return;
    busy.current = true; setPending(true); setMessage("");
    try {
      if (action === "verify-contact/start" && !requestKey.current) requestKey.current = volunteerRequestKey();
      if (action === "replace" && !replacementKey.current) {
        // Persist only the non-secret operation ID before sending. A reload
        // after a lost HTTP response must retry the same durable operation.
        const pendingKey = sessionStorage.getItem(replacementStorageKey) || volunteerRequestKey();
        sessionStorage.setItem(replacementStorageKey, pendingKey);
        replacementKey.current = pendingKey;
      }
      if (!completionKey.current) completionKey.current = volunteerRequestKey();
      const result = await manageVolunteerPersonalAccess(churchId, memberId, action, {
        channel, requestKey: action === "replace" ? replacementKey.current : requestKey.current, challengeId: challenge, code, completionKey: completionKey.current,
      });
      if (!mounted.current) return;
      if (["prepare", "replace", "revoke", "restore"].includes(action)) {
        sessionStorage.removeItem(replacementStorageKey);
        replacementKey.current = "";
      }
      if (result.url) { setUrl(result.url); setStatus("active"); }
      if (action === "revoke") { setStatus("revoked"); setUrl(""); }
      if (action === "restore") { setStatus("none"); setUrl(""); }
      if (result.challengeId) { setChallenge(result.challengeId); setMessage("Ask the volunteer for the code sent to their saved contact. Shared contacts and phone numbers without SMS consent are not eligible."); }
      if (action === "verify-contact/complete") { setChallenge(""); setCode(""); requestKey.current = ""; completionKey.current = ""; setMessage("Recovery contact verified."); }
    } catch (error) { if (mounted.current) showApiErrorToast(showToast, error, "Could not update personal access."); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  };
  if (!status) return null;
  return <details className="rounded-lg border border-gray-700 p-3">
    <summary className="cursor-pointer font-semibold">Personal My Schedule access</summary>
    <div className="mt-3 flex flex-col gap-3">
      <p className="text-sm text-gray-300">Status: {status}. Replacing or turning off access invalidates previous links and sessions. Preparing a link does not send a message.</p>
      <div className="flex flex-wrap gap-2">
        {status === "revoked" ? <Button disabled={pending} onClick={() => void act("restore")}>Restore personal access</Button> : <>
          <Button disabled={pending} onClick={() => void act("prepare")}>Prepare personal link</Button>
          <Button variant="secondary" disabled={pending} onClick={() => void act("replace")}>Replace personal link</Button>
          <Button variant="secondary" disabled={pending} onClick={() => void act("revoke")}>Turn off personal access</Button>
        </>}
      </div>
      {url ? <a className="break-all text-sm text-orange-300 underline" href={url} target="_blank" rel="noopener noreferrer">{url}</a> : null}
      {status !== "revoked" ? <>
        <Select label="Recovery contact" value={channel} options={[{ value: "email", label: "Saved email" }, { value: "sms", label: "Saved mobile number" }]}
          onChange={(value) => { setChannel(value); setChallenge(""); requestKey.current = ""; completionKey.current = ""; }} />
        {challenge ? <>
          <Input label="Contact verification code" value={code} onChange={(value) => setCode(String(value))} />
          <Button disabled={pending || !code} onClick={() => void act("verify-contact/complete")}>Verify recovery contact</Button>
          <Button variant="secondary" disabled={pending} onClick={() => { setChallenge(""); requestKey.current = ""; completionKey.current = ""; }}>Request another code</Button>
        </> : <Button variant="secondary" disabled={pending} onClick={() => void act("verify-contact/start")}>Send contact verification code</Button>}
      </> : null}
      {pending ? <p role="status" className="text-sm">Updating personal access…</p> : null}
      {message ? <p role="status" className="text-sm text-gray-300">{message}</p> : null}
    </div>
  </details>;
};
export default VolunteerPersonalAccessControls;
