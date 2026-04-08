import {
  memo,
  useCallback,
  useEffect,
  useState,
} from "react";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import { useToast } from "../../context/toastContext";
import {
  createAdminInvite,
  createDisplayPairing,
  createWorkstationPairing,
  sendPairingCodeEmail,
  updateRecoveryEmail,
} from "../../api/auth";
import { isValidEmailFormat } from "../../utils/emailFormat";

type InviteAccessOption = "admin" | "full" | "music" | "view";
type WorkstationAccessOption = "full" | "music" | "view";
type DisplaySurfaceOption =
  | "projector"
  | "projector-display"
  | "monitor"
  | "stream"
  | "stream-info"
  | "credits";

const inviteOptions: {
  value: InviteAccessOption;
  label: string;
  role: string;
  appAccess: string;
}[] = [
  { value: "full", label: "Full access", role: "member", appAccess: "full" },
  { value: "music", label: "Music access", role: "member", appAccess: "music" },
  { value: "view", label: "View access", role: "member", appAccess: "view" },
  { value: "admin", label: "Admin", role: "admin", appAccess: "full" },
];

const inviteSelectOptions = inviteOptions.map(({ value, label }) => ({
  value,
  label,
}));

const workstationAccessOptions: {
  value: WorkstationAccessOption;
  label: string;
}[] = [
  { value: "full", label: "Full access" },
  { value: "music", label: "Music access" },
  { value: "view", label: "View access" },
];

const displaySurfaceOptions: {
  value: DisplaySurfaceOption;
  label: string;
}[] = [
  { value: "projector", label: "Projector (full frame)" },
  { value: "projector-display", label: "Projector (display output)" },
  { value: "monitor", label: "Monitor" },
  { value: "stream", label: "Stream" },
  { value: "stream-info", label: "Stream info" },
  { value: "credits", label: "Credits" },
];

const formatAccountError = (error: unknown, fallback: string): string => {
  const raw = error instanceof Error ? error.message.trim() : String(error).trim();
  if (!raw) return fallback;
  if (raw === "Request failed") {
    return "Could not reach the server. Check your connection and try again.";
  }
  if (
    raw.length < 160 &&
    !raw.includes("at ") &&
    !raw.toLowerCase().includes("stack")
  ) {
    return raw;
  }
  return fallback;
};

type PairingCodeBannerProps = {
  variant: "workstation" | "display";
  label: string;
  token: string;
  churchId: string;
};

const PairingCodeBanner = ({
  variant,
  label,
  token,
  churchId,
}: PairingCodeBannerProps) => {
  const { showToast } = useToast();
  const title = variant === "workstation" ? "Workstation" : "Display";
  const [copyStatus, setCopyStatus] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailStepOpen, setEmailStepOpen] = useState(false);

  useEffect(() => {
    setEmailStepOpen(false);
    setEmailTo("");
    setEmailError("");
  }, [token]);
  const route =
    variant === "workstation" ? "/workstation/pair" : "/display/pair";
  const setupPath = `${route}?token=${encodeURIComponent(token)}`;
  const instructionTarget =
    variant === "workstation" ? "shared workstation" : "display screen";
  const setupUrl = (() => {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    url.hash = setupPath;
    return url.toString();
  })();

  const copyText = async (value: string, successMessage: string) => {
    if (!value || !navigator?.clipboard?.writeText) return;
    await navigator.clipboard.writeText(value);
    setCopyStatus(successMessage);
  };

  const handleSendPairingEmail = async () => {
    const trimmed = emailTo.trim();
    if (!trimmed) {
      setEmailError("Enter an email address");
      return;
    }
    if (!isValidEmailFormat(trimmed)) {
      setEmailError("Enter a valid email address");
      return;
    }
    setEmailError("");
    setEmailSending(true);
    try {
      await sendPairingCodeEmail(churchId, {
        kind: variant === "workstation" ? "workstation" : "display",
        token,
        to: trimmed,
      });
      showToast("Setup code sent.", "success");
      setEmailTo("");
      setEmailStepOpen(false);
    } catch (error) {
      showToast(
        formatAccountError(error, "Could not send that email. Try again."),
        "error",
      );
    } finally {
      setEmailSending(false);
    }
  };

  return (
    <div
      className="mt-4 rounded-lg border border-cyan-500/30 bg-gray-900/50 px-3 py-3"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm text-cyan-300">
        {title} code for <span className="font-semibold">{label}</span>:{" "}
        <span className="font-mono font-semibold tracking-wide">{token}</span>
      </p>
      <p className="mt-2 text-sm text-gray-200">
        On the {instructionTarget}, open WorshipSync and choose the setup option for this device,
        or go to <span className="font-mono">/#/{route.replace(/^\//, "")}</span>. Use{" "}
        <span className="font-medium text-gray-100">Pair in this window</span> or{" "}
        <span className="font-medium text-gray-100">Copy setup link</span> to open or share the
        full URL with this code filled in.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          component="link"
          variant="tertiary"
          to={setupPath}
        >
          Pair in this window
        </Button>
        <Button
          variant="tertiary"
          onClick={() =>
            void copyText(setupUrl, `${title} setup link copied.`)
          }
          disabled={!setupUrl}
        >
          Copy setup link
        </Button>
        <Button
          variant="tertiary"
          onClick={() => void copyText(token, `${title} setup code copied.`)}
        >
          Copy code
        </Button>
      </div>
      {copyStatus ? (
        <p className="mt-2 text-sm text-cyan-300">{copyStatus}</p>
      ) : null}
      <div className="mt-4 border-t border-gray-600/50 pt-3">
        {!emailStepOpen ? (
          <Button
            type="button"
            variant="tertiary"
            disabled={!churchId}
            onClick={() => setEmailStepOpen(true)}
          >
            Email code
          </Button>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <Input
                className="min-w-0 flex-1"
                id={`pairing-email-${variant}`}
                label="Email"
                type="email"
                autoComplete="email"
                value={emailTo}
                disabled={emailSending || !churchId}
                errorText={emailError}
                onChange={(value) => {
                  setEmailTo(String(value));
                  setEmailError("");
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (emailSending || !churchId) return;
                  void handleSendPairingEmail();
                }}
              />
              <Button
                variant="cta"
                className="w-full shrink-0 justify-center sm:w-auto"
                isLoading={emailSending}
                disabled={emailSending || !churchId}
                onClick={() => void handleSendPairingEmail()}
              >
                Send code
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Sends the setup code and link. Email must be enabled on the server.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

type InvitePeopleFormProps = {
  churchId: string;
  onInvited: () => void | Promise<void>;
};

export const InvitePeopleForm = memo(function InvitePeopleForm({
  churchId,
  onInvited,
}: InvitePeopleFormProps) {
  const { showToast } = useToast();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteAccess, setInviteAccess] = useState<InviteAccessOption>("full");
  const [inviteEmailError, setInviteEmailError] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleSend = useCallback(async () => {
    const email = inviteEmail.trim();
    const selectedInviteOption =
      inviteOptions.find((option) => option.value === inviteAccess) ||
      inviteOptions[0];
    if (!email) {
      setInviteEmailError("Enter an email before sending the invite");
      return;
    }
    setInviteEmailError("");
    setIsSending(true);
    try {
      const response = await createAdminInvite(churchId, {
        email,
        role: selectedInviteOption.role,
        appAccess: selectedInviteOption.appAccess,
      });
      setInviteEmail("");
      await onInvited();
      showToast(
        `Invite created for ${response.invite.email} with ${selectedInviteOption.label.toLowerCase()}.`,
        "success",
      );
    } catch (error) {
      showToast(
        formatAccountError(error, "Could not complete that. Try again."),
        "error",
      );
    } finally {
      setIsSending(false);
    }
  }, [churchId, inviteAccess, inviteEmail, onInvited, showToast]);

  return (
    <section className="rounded-xl border border-gray-600 bg-gray-900/25 p-4">
      <h3 className="text-lg font-semibold">Invite people</h3>
      <p className="mt-1 text-sm text-gray-400">
        Send an email invite and pick an access level first.
      </p>
      <div className="mt-4 flex flex-row flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-[min(100%,14rem)] md:flex-2 md:basis-0">
          <Input
            id="invite-email"
            label="Email"
            value={inviteEmail}
            errorText={inviteEmailError}
            onChange={(value) => {
              setInviteEmail(String(value));
              setInviteEmailError("");
            }}
          />
        </div>
        <div className="min-w-0 flex-1 basis-[min(100%,10rem)] md:basis-0">
          <Select
            className="w-full"
            id="invite-access"
            label="Access"
            labelClassName="text-gray-200"
            value={inviteAccess}
            onChange={(value) =>
              setInviteAccess(value as InviteAccessOption)
            }
            options={inviteSelectOptions}
            selectClassName="mt-1 w-full"
          />
        </div>
        <Button
          className="shrink-0"
          variant="cta"
          isLoading={isSending}
          disabled={isSending}
          onClick={() => void handleSend()}
        >
          {isSending ? "Sending invite..." : "Send invite"}
        </Button>
      </div>
    </section>
  );
});

type WorkstationPairingFormProps = {
  churchId: string;
  formsResetSignal: number;
  onGenerated: () => void | Promise<void>;
};

export const WorkstationPairingForm = memo(function WorkstationPairingForm({
  churchId,
  formsResetSignal,
  onGenerated,
}: WorkstationPairingFormProps) {
  const { showToast } = useToast();
  const [pairLabel, setPairLabel] = useState("");
  const [workstationAccess, setWorkstationAccess] =
    useState<WorkstationAccessOption>("full");
  const [labelError, setLabelError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [workstationPairingCode, setWorkstationPairingCode] = useState<{
    label: string;
    token: string;
  } | null>(null);

  useEffect(() => {
    setWorkstationPairingCode(null);
  }, [formsResetSignal]);

  const handleGenerate = useCallback(async () => {
    const label = pairLabel.trim();
    if (!label) {
      setLabelError("Enter a workstation label first");
      return;
    }
    setLabelError("");
    setIsGenerating(true);
    try {
      const response = await createWorkstationPairing(churchId, {
        label,
        appAccess: workstationAccess,
      });
      const token = response.pairing.token;
      if (!token) {
        showToast(
          "Pairing code was not returned. Try again.",
          "error",
        );
        return;
      }
      setPairLabel("");
      setWorkstationPairingCode({
        label: response.pairing.label,
        token,
      });
      await onGenerated();
    } catch (error) {
      showToast(
        formatAccountError(error, "Could not complete that. Try again."),
        "error",
      );
    } finally {
      setIsGenerating(false);
    }
  }, [churchId, onGenerated, pairLabel, showToast, workstationAccess]);

  return (
    <>
      <div className="mt-4 flex flex-row flex-wrap items-end gap-3">
        <Input
          className="min-w-0 flex-1"
          id="workstation-label"
          label="Label"
          value={pairLabel}
          errorText={labelError}
          onChange={(value) => {
            setPairLabel(String(value));
            setLabelError("");
          }}
        />
        <Select
          className="min-w-48"
          id="workstation-access"
          label="Access"
          value={workstationAccess}
          options={workstationAccessOptions}
          onChange={(value) => {
            setWorkstationAccess(value as WorkstationAccessOption);
          }}
        />
        <Button
          className="shrink-0"
          variant="cta"
          isLoading={isGenerating}
          disabled={isGenerating}
          onClick={() => void handleGenerate()}
        >
          {isGenerating ? "Generating code..." : "Generate code"}
        </Button>
      </div>
      {workstationPairingCode && (
        <PairingCodeBanner
          variant="workstation"
          label={workstationPairingCode.label}
          token={workstationPairingCode.token}
          churchId={churchId}
        />
      )}
    </>
  );
});

type DisplayPairingFormProps = {
  churchId: string;
  formsResetSignal: number;
  onGenerated: () => void | Promise<void>;
};

export const DisplayPairingForm = memo(function DisplayPairingForm({
  churchId,
  formsResetSignal,
  onGenerated,
}: DisplayPairingFormProps) {
  const { showToast } = useToast();
  const [displayLabel, setDisplayLabel] = useState("");
  const [displaySurface, setDisplaySurface] =
    useState<DisplaySurfaceOption>("projector");
  const [labelError, setLabelError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [displayPairingCode, setDisplayPairingCode] = useState<{
    label: string;
    token: string;
  } | null>(null);

  useEffect(() => {
    setDisplayPairingCode(null);
  }, [formsResetSignal]);

  const handleGenerate = useCallback(async () => {
    const label = displayLabel.trim();
    if (!label) {
      setLabelError("Enter a display label first");
      return;
    }
    setLabelError("");
    setIsGenerating(true);
    try {
      const response = await createDisplayPairing(churchId, {
        label,
        surfaceType: displaySurface,
      });
      const token = response.pairing.token;
      if (!token) {
        showToast(
          "Pairing code was not returned. Try again.",
          "error",
        );
        return;
      }
      setDisplayLabel("");
      setDisplayPairingCode({
        label: response.pairing.label,
        token,
      });
      await onGenerated();
    } catch (error) {
      showToast(
        formatAccountError(error, "Could not complete that. Try again."),
        "error",
      );
    } finally {
      setIsGenerating(false);
    }
  }, [churchId, displayLabel, displaySurface, onGenerated, showToast]);

  return (
    <>
      <div className="mt-4 flex flex-row flex-wrap items-end gap-3">
        <Input
          className="min-w-0 flex-1"
          id="display-label"
          label="Label"
          value={displayLabel}
          errorText={labelError}
          onChange={(value) => {
            setDisplayLabel(String(value));
            setLabelError("");
          }}
        />
        <Select
          className="min-w-48"
          id="display-surface"
          label="Surface"
          value={displaySurface}
          options={displaySurfaceOptions}
          onChange={(value) => {
            setDisplaySurface(value as DisplaySurfaceOption);
          }}
        />
        <Button
          className="shrink-0"
          variant="cta"
          isLoading={isGenerating}
          disabled={isGenerating}
          onClick={() => void handleGenerate()}
        >
          {isGenerating ? "Generating code..." : "Generate code"}
        </Button>
      </div>
      {displayPairingCode && (
        <PairingCodeBanner
          variant="display"
          label={displayPairingCode.label}
          token={displayPairingCode.token}
          churchId={churchId}
        />
      )}
    </>
  );
});

type RecoveryEmailFormProps = {
  churchId: string;
  recoveryEmailFromContext?: string | null;
};

export const RecoveryEmailForm = memo(function RecoveryEmailForm({
  churchId,
  recoveryEmailFromContext,
}: RecoveryEmailFormProps) {
  const { showToast } = useToast();
  const [recoveryEmail, setRecoveryEmail] = useState(
    () => recoveryEmailFromContext || "",
  );
  const [errorText, setErrorText] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setRecoveryEmail(recoveryEmailFromContext || "");
  }, [recoveryEmailFromContext]);

  const handleSave = useCallback(async () => {
    const email = recoveryEmail.trim();
    if (!email) {
      setErrorText("Enter a recovery email before saving");
      return;
    }
    setErrorText("");
    setIsSaving(true);
    try {
      await updateRecoveryEmail(churchId, email);
      showToast("Recovery email saved.", "success");
    } catch (error) {
      showToast(
        formatAccountError(error, "Could not complete that. Try again."),
        "error",
      );
    } finally {
      setIsSaving(false);
    }
  }, [churchId, recoveryEmail, showToast]);

  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
      <div className="min-w-0 flex-1">
        <Input
          id="recovery-email"
          label="Recovery Email"
          value={recoveryEmail}
          errorText={errorText}
          onChange={(value) => {
            setRecoveryEmail(String(value));
            setErrorText("");
          }}
        />
      </div>
      <Button
        className="w-full shrink-0 sm:w-auto"
        variant="cta"
        isLoading={isSaving}
        disabled={isSaving}
        onClick={() => void handleSave()}
      >
        {isSaving ? "Saving recovery email..." : "Save recovery email"}
      </Button>
    </div>
  );
});
