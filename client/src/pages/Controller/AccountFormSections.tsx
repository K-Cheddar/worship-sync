import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  Copy,
  ExternalLink,
  KeyRound,
  Mail,
  RotateCcw,
  Save,
  Send,
  Upload,
  X,
} from "lucide-react";
import { Cloudinary } from "@cloudinary/url-gen";
import Button from "../../components/Button/Button";
import ColorField from "../../components/ColorField/ColorField";
import Input from "../../components/Input/Input";
import Select from "../../components/Select/Select";
import Spinner from "../../components/Spinner/Spinner";
import TextArea from "../../components/TextArea/TextArea";
import { useToast } from "../../context/toastContext";
import {
  createAdminInvite,
  createDisplayPairing,
  createWorkstationPairing,
  sendPairingCodeEmail,
  updateChurchBranding,
  updateRecoveryEmail,
} from "../../api/auth";
import type {
  ChurchBrandColor,
  ChurchBranding,
  ChurchLogoAsset,
} from "../../api/authTypes";
import { uploadImageToCloudinary } from "../../containers/Media/utils/cloudinaryUpload";
import {
  INVALID_EMAIL_FORMAT_MESSAGE,
  isValidEmailFormat,
} from "../../utils/emailFormat";
import { deleteFromCloudinary } from "../../utils/cloudinaryUtils";
import {
  BRAND_HEX_COLOR_RE,
  BRANDING_MAX_COLORS,
  BRANDING_MAX_LABEL_LENGTH,
  BRANDING_MAX_TEXT_LENGTH,
  type BrandColorSlot,
  compactBrandColorSlots,
  normalizeChurchBranding,
  padBrandColorsToSlots,
  serializeChurchBranding,
} from "../../utils/churchBranding";
import { cn } from "@/utils/cnHelper";

const CLOUDINARY_CLOUD_NAME = "portable-media";
const CLOUDINARY_UNSIGNED_UPLOAD_PRESET = "bpqu4ma5";
const MAX_LOGO_FILE_BYTES = 5 * 1024 * 1024;
const BRANDING_LOGO_ACCEPT = ".png,.jpg,.jpeg,.webp,.svg";
const BRANDING_ALLOWED_LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);
const brandingCloud = new Cloudinary({
  cloud: { cloudName: CLOUDINARY_CLOUD_NAME },
});

const BRAND_COLOR_LABEL_PLACEHOLDERS = [
  "e.g. Primary",
  "e.g. Accent",
  "e.g. Background",
  "e.g. Text",
  "e.g. Highlight",
  "e.g. Border",
] as const;

type BrandingLogoSlot = "square" | "wide";

type BrandingFormProps = {
  churchId: string;
  branding: ChurchBranding;
  brandingStatus: "loading" | "ready";
};

type PendingLogoFiles = Record<BrandingLogoSlot, File | null>;
type LogoPreviewMap = Record<BrandingLogoSlot, string | null>;

const brandingLogoSlotContent: Record<
  BrandingLogoSlot,
  { title: string; helperText: string }
> = {
  square: {
    title: "Square logo",
    helperText:
      "PNG, JPG, WEBP, or SVG. 5 MB max. Square images work best at 512x512 or larger.",
  },
  wide: {
    title: "Wide logo",
    helperText:
      "PNG, JPG, WEBP, or SVG. 5 MB max. Wide images work best at 1200x400 or larger.",
  },
};

const createEmptyPendingLogoFiles = (): PendingLogoFiles => ({
  square: null,
  wide: null,
});

const createEmptyLogoPreviewMap = (): LogoPreviewMap => ({
  square: null,
  wide: null,
});

const revokePreviewUrl = (value?: string | null) => {
  if (value?.startsWith("blob:")) {
    URL.revokeObjectURL(value);
  }
};

const getReadableFileType = (file: File) => {
  const extension = file.name.split(".").pop();
  return extension ? extension.toUpperCase() : "file";
};

const toChurchLogoAsset = (
  media: Awaited<ReturnType<typeof uploadImageToCloudinary>>,
): ChurchLogoAsset => ({
  url: media.secure_url || media.url,
  publicId: media.public_id,
  ...(media.width ? { width: media.width } : {}),
  ...(media.height ? { height: media.height } : {}),
  ...(media.format ? { format: media.format } : {}),
});

const getBrandingValidationMessage = (branding: ChurchBranding) => {
  if (branding.mission.trim().length > BRANDING_MAX_TEXT_LENGTH) {
    return `Mission must be ${BRANDING_MAX_TEXT_LENGTH} characters or less.`;
  }
  if (branding.vision.trim().length > BRANDING_MAX_TEXT_LENGTH) {
    return `Vision must be ${BRANDING_MAX_TEXT_LENGTH} characters or less.`;
  }
  if (branding.colors.length > BRANDING_MAX_COLORS) {
    return `You can save up to ${BRANDING_MAX_COLORS} brand colors.`;
  }

  const seenLabels = new Set<string>();
  for (let index = 0; index < branding.colors.length; index += 1) {
    const color = branding.colors[index];
    const label = String(color.label || "").trim();
    if (label.length > BRANDING_MAX_LABEL_LENGTH) {
      return `Brand color labels must be ${BRANDING_MAX_LABEL_LENGTH} characters or less.`;
    }
    if (label) {
      const labelKey = label.toLowerCase();
      if (seenLabels.has(labelKey)) {
        return "Brand color labels must be unique after trimming.";
      }
      seenLabels.add(labelKey);
    }
    if (!BRAND_HEX_COLOR_RE.test(String(color.value || "").trim())) {
      return `Brand color ${index + 1} must use #RRGGBB or #RRGGBBAA.`;
    }
  }

  return "";
};

/** Field-wise dirty check; avoids serializing the full draft on every keystroke. */
const isBrandingDirtyFromLive = (
  mission: string,
  vision: string,
  logos: ChurchBranding["logos"],
  live: ChurchBranding,
  brandColorSlots: BrandColorSlot[],
  hasPendingLogos: boolean,
): boolean => {
  if (hasPendingLogos) {
    return true;
  }
  if (mission.trim() !== live.mission.trim()) {
    return true;
  }
  if (vision.trim() !== live.vision.trim()) {
    return true;
  }
  if (JSON.stringify(logos) !== JSON.stringify(live.logos)) {
    return true;
  }
  const draftColors = compactBrandColorSlots(brandColorSlots);
  if (JSON.stringify(draftColors) !== JSON.stringify(live.colors)) {
    return true;
  }
  return false;
};

const formatBrandingSaveError = (error: unknown) =>
  formatAccountError(error, "Could not save branding. Try again.");

const cleanupLogoAssets = async (assets: Array<ChurchLogoAsset | null>) => {
  await Promise.all(
    assets
      .filter((asset): asset is ChurchLogoAsset => Boolean(asset?.publicId))
      .map(async (asset) => {
        try {
          await deleteFromCloudinary(brandingCloud, asset.publicId, "image");
        } catch (error) {
          console.warn("Could not delete branding asset:", error);
        }
      }),
  );
};

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

export const ACCOUNT_CONTROL_INPUT_CLASSNAME = "h-9 max-md:min-h-14";
export const ACCOUNT_CONTROL_SELECT_CLASSNAME = "h-9 max-md:min-h-14";

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
    if (!value) {
      showToast("Nothing to copy.", "error");
      return;
    }
    if (!navigator?.clipboard?.writeText) {
      showToast(
        "Could not access the clipboard. Check browser permissions and try again.",
        "error",
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      showToast(successMessage, "success");
    } catch {
      showToast("Could not copy. Try again.", "error");
    }
  };

  const handleSendPairingEmail = async () => {
    const trimmed = emailTo.trim();
    if (!trimmed) {
      setEmailError("Enter an email address");
      return;
    }
    if (!isValidEmailFormat(trimmed)) {
      setEmailError(INVALID_EMAIL_FORMAT_MESSAGE);
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
      showToast("Link code sent.", "success");
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
        On the {instructionTarget}, open WorshipSync and choose the option to link this device,
        or go to <span className="font-mono">/#/{route.replace(/^\//, "")}</span>. Use{" "}
        <span className="font-medium text-gray-100">Link in this window</span> or{" "}
        <span className="font-medium text-gray-100">Copy device link</span> to open or share the
        full URL with this code filled in.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          component="link"
          variant="tertiary"
          svg={ExternalLink}
          iconSize="sm"
          to={setupPath}
        >
          Link in this window
        </Button>
        <Button
          variant="tertiary"
          svg={Copy}
          iconSize="sm"
          onClick={() =>
            void copyText(setupUrl, `${title} device link copied.`)
          }
          disabled={!setupUrl}
        >
          Copy device link
        </Button>
        <Button
          variant="tertiary"
          svg={Copy}
          iconSize="sm"
          onClick={() => void copyText(token, `${title} link code copied.`)}
        >
          Copy code
        </Button>
      </div>
      <div className="mt-4 border-t border-gray-600/50 pt-3">
        {!emailStepOpen ? (
          <Button
            type="button"
            variant="tertiary"
            svg={Mail}
            iconSize="sm"
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
                inputClassName={ACCOUNT_CONTROL_INPUT_CLASSNAME}
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
                svg={Send}
                iconSize="sm"
                className="w-full shrink-0 justify-center sm:w-auto"
                isLoading={emailSending}
                disabled={emailSending || !churchId}
                onClick={() => void handleSendPairingEmail()}
              >
                Send code
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Sends the link code and device link. Email must be enabled on the server.
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
            inputClassName={ACCOUNT_CONTROL_INPUT_CLASSNAME}
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
            selectClassName={cn("mt-1 w-full", ACCOUNT_CONTROL_SELECT_CLASSNAME)}
          />
        </div>
        <Button
          className="shrink-0"
          variant="cta"
          svg={Send}
          iconSize="sm"
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
          "Link code was not returned. Try again.",
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
          inputClassName={ACCOUNT_CONTROL_INPUT_CLASSNAME}
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
          selectClassName={ACCOUNT_CONTROL_SELECT_CLASSNAME}
          onChange={(value) => {
            setWorkstationAccess(value as WorkstationAccessOption);
          }}
        />
        <Button
          className="w-full shrink-0 justify-center sm:w-auto"
          variant="cta"
          svg={KeyRound}
          iconSize="sm"
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
          "Link code was not returned. Try again.",
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
          inputClassName={ACCOUNT_CONTROL_INPUT_CLASSNAME}
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
          selectClassName={ACCOUNT_CONTROL_SELECT_CLASSNAME}
          onChange={(value) => {
            setDisplaySurface(value as DisplaySurfaceOption);
          }}
        />
        <Button
          className="w-full shrink-0 justify-center sm:w-auto"
          variant="cta"
          svg={KeyRound}
          iconSize="sm"
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
          inputClassName={ACCOUNT_CONTROL_INPUT_CLASSNAME}
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
        svg={Save}
        iconSize="sm"
        isLoading={isSaving}
        disabled={isSaving}
        onClick={() => void handleSave()}
      >
        {isSaving ? "Saving recovery email..." : "Save recovery email"}
      </Button>
    </div>
  );
});

const BrandingMissionVisionFields = memo(function BrandingMissionVisionFields({
  mission,
  vision,
  onMissionChange,
  onVisionChange,
}: {
  mission: string;
  vision: string;
  onMissionChange: (value: string) => void;
  onVisionChange: (value: string) => void;
}) {
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <div>
        <TextArea
          label="Mission"
          value={mission}
          maxLength={BRANDING_MAX_TEXT_LENGTH}
          autoResize
          className="w-full"
          textareaClassName="min-h-28 w-full"
          labelClassName="text-gray-200"
          onChange={onMissionChange}
        />
        <p className="mt-1 text-xs text-gray-400">
          {mission.trim().length}/{BRANDING_MAX_TEXT_LENGTH}
        </p>
      </div>
      <div>
        <TextArea
          label="Vision"
          value={vision}
          maxLength={BRANDING_MAX_TEXT_LENGTH}
          autoResize
          className="w-full"
          textareaClassName="min-h-28 w-full"
          labelClassName="text-gray-200"
          onChange={onVisionChange}
        />
        <p className="mt-1 text-xs text-gray-400">
          {vision.trim().length}/{BRANDING_MAX_TEXT_LENGTH}
        </p>
      </div>
    </div>
  );
});

const BrandingLogoSlotsSection = memo(function BrandingLogoSlotsSection({
  logos,
  pendingLogoFiles,
  logoPreviewUrls,
  logoFileInputRefs,
  onLogoFileChange,
  onRemoveLogo,
  onChooseFileClick,
}: {
  logos: ChurchBranding["logos"];
  pendingLogoFiles: PendingLogoFiles;
  logoPreviewUrls: LogoPreviewMap;
  logoFileInputRefs: MutableRefObject<
    Record<BrandingLogoSlot, HTMLInputElement | null>
  >;
  onLogoFileChange: (slot: BrandingLogoSlot, file: File | null) => void;
  onRemoveLogo: (slot: BrandingLogoSlot) => void;
  onChooseFileClick: (slot: BrandingLogoSlot) => void;
}) {
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      {(["square", "wide"] as BrandingLogoSlot[]).map((slot) => {
        const config = brandingLogoSlotContent[slot];
        const pendingFile = pendingLogoFiles[slot];
        const currentLogo = logos[slot] || null;
        const previewUrl = logoPreviewUrls[slot] || currentLogo?.url || "";

        return (
          <div
            key={slot}
            className="rounded-lg border border-gray-600/70 bg-gray-950/35 p-4"
          >
            <h4 className="text-sm font-semibold text-gray-100">{config.title}</h4>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">
              {config.helperText}
            </p>

            <div className="mt-4 flex flex-col gap-3">
              {previewUrl ? (
                <div className="relative overflow-hidden rounded-lg border border-gray-600 bg-white/95 p-3">
                  <img
                    src={previewUrl}
                    alt={config.title}
                    className="mx-auto max-h-28 w-auto max-w-full object-contain"
                  />
                  <Button
                    type="button"
                    variant="tertiary"
                    svg={X}
                    iconSize="xs"
                    aria-label={`Remove ${config.title}`}
                    title={`Remove ${config.title}`}
                    className="absolute top-2 right-2 h-8 w-8 min-h-0 shrink-0 rounded-full border border-gray-600/80 bg-gray-900/80 p-0 text-gray-100 hover:bg-gray-800/90"
                    onClick={() => onRemoveLogo(slot)}
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-600 px-3 py-6 text-center text-sm text-gray-400">
                  No logo selected.
                </div>
              )}

              <div className="flex flex-col gap-2">
                <input
                  ref={(el) => {
                    logoFileInputRefs.current[slot] = el;
                  }}
                  aria-label={`${config.title} file`}
                  type="file"
                  accept={BRANDING_LOGO_ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (file) {
                      onLogoFileChange(slot, file);
                    }
                    event.currentTarget.value = "";
                  }}
                />
                <Button
                  type="button"
                  className="w-full justify-center"
                  svg={Upload}
                  iconSize="sm"
                  aria-label={`Choose file for ${config.title}`}
                  onClick={() => onChooseFileClick(slot)}
                >
                  Choose file
                </Button>
                {pendingFile ? (
                  <p className="text-xs text-gray-400">
                    {getReadableFileType(pendingFile)} selected. Save branding to
                    make it live.
                  </p>
                ) : null}
                {!pendingFile && currentLogo ? (
                  <p className="text-xs text-gray-400">This logo is live now.</p>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

const BrandingColorSlotsSection = memo(function BrandingColorSlotsSection({
  brandColorSlots,
  patchBrandColorSlot,
  clearBrandColorSlot,
}: {
  brandColorSlots: BrandColorSlot[];
  patchBrandColorSlot: (
    index: number,
    patch: Partial<ChurchBrandColor>,
  ) => void;
  clearBrandColorSlot: (index: number) => void;
}) {
  return (
    <div className="mt-6 rounded-lg border border-gray-600/70 bg-gray-950/35 p-4">
      <div className="w-full min-w-0">
        <h4 className="text-sm font-semibold text-gray-100">Brand colors</h4>
        <p className="mt-1 w-full text-xs leading-relaxed text-gray-400">
          These colors can be used throughout the app. Labels are optional—keep
          them short and unique. You can save up to six colors; only slots you
          use are included when you save.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: BRANDING_MAX_COLORS }, (_, index) => {
          const slot = brandColorSlots[index];
          const filled = slot !== null;

          return (
            <div
              key={`brand-color-slot-${index}`}
              className={cn(
                "flex flex-col gap-3 rounded-lg p-3 transition-colors",
                filled
                  ? "border-2 border-solid border-cyan-500/35 bg-gray-900/55 shadow-md shadow-black/25 ring-1 ring-cyan-500/15"
                  : "border-2 border-dashed border-gray-600/70 bg-gray-950/80",
              )}
            >
              <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      filled ? "text-gray-100" : "text-gray-500",
                    )}
                  >
                    Color {index + 1}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      filled
                        ? "border border-cyan-500/40 bg-cyan-950/50 text-cyan-200/95"
                        : "border border-gray-600/80 bg-gray-900/80 text-gray-500",
                    )}
                  >
                    {filled ? "Set" : "Not set"}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="tertiary"
                  svg={X}
                  iconSize="sm"
                  tabIndex={filled ? 0 : -1}
                  aria-hidden={!filled}
                  className={cn(
                    "shrink-0 justify-self-end text-xs",
                    !filled && "invisible pointer-events-none",
                  )}
                  disabled={!filled}
                  onClick={() => clearBrandColorSlot(index)}
                >
                  Remove
                </Button>
              </div>

              <div className="max-w-full">
                <Input
                  id={`brand-color-label-${index}`}
                  label="Label"
                  labelClassName="text-gray-200"
                  value={slot?.label ?? ""}
                  maxLength={BRANDING_MAX_LABEL_LENGTH}
                  inputClassName="max-w-full"
                  placeholder={BRAND_COLOR_LABEL_PLACEHOLDERS[index]}
                  onChange={(value) =>
                    patchBrandColorSlot(index, { label: String(value) })
                  }
                />
              </div>
              <ColorField
                className="w-full max-w-none items-stretch"
                label="Color"
                value={slot?.value ?? "#FFFFFF"}
                onChange={(value) => patchBrandColorSlot(index, { value })}
                onPopoverOpenChange={(open) => {
                  if (open && slot === null) {
                    patchBrandColorSlot(index, { value: "#FFFFFF", label: "" });
                  }
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const BrandingForm = memo(function BrandingForm({
  churchId,
  branding,
  brandingStatus,
}: BrandingFormProps) {
  const { showToast } = useToast();
  const [draftBranding, setDraftBranding] = useState<ChurchBranding>(() =>
    normalizeChurchBranding(branding),
  );
  const [brandColorSlots, setBrandColorSlots] = useState<BrandColorSlot[]>(
    () => padBrandColorsToSlots(normalizeChurchBranding(branding).colors),
  );
  const [pendingLogoFiles, setPendingLogoFiles] = useState<PendingLogoFiles>(
    createEmptyPendingLogoFiles,
  );
  const [logoPreviewUrls, setLogoPreviewUrls] = useState<LogoPreviewMap>(
    createEmptyLogoPreviewMap,
  );
  const logoFileInputRefs = useRef<
    Record<BrandingLogoSlot, HTMLInputElement | null>
  >({ square: null, wide: null });
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const liveBrandingBaseline = useMemo(
    () => normalizeChurchBranding(branding),
    [branding],
  );
  const liveBrandSerializedKey = useMemo(
    () => serializeChurchBranding(liveBrandingBaseline),
    [liveBrandingBaseline],
  );
  const mergedBranding = useMemo<ChurchBranding>(
    () => ({
      ...draftBranding,
      colors: compactBrandColorSlots(brandColorSlots),
    }),
    [draftBranding, brandColorSlots],
  );

  const hasPendingLogos = Boolean(
    pendingLogoFiles.square || pendingLogoFiles.wide,
  );
  const isDirty = useMemo(
    () =>
      isBrandingDirtyFromLive(
        draftBranding.mission,
        draftBranding.vision,
        draftBranding.logos,
        liveBrandingBaseline,
        brandColorSlots,
        hasPendingLogos,
      ),
    [
      draftBranding.mission,
      draftBranding.vision,
      draftBranding.logos,
      liveBrandingBaseline,
      brandColorSlots,
      hasPendingLogos,
    ],
  );
  const isDirtyRef = useRef(isDirty);
  const isSavingRef = useRef(isSaving);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  useEffect(() => {
    if (
      brandingStatus !== "ready" ||
      isDirtyRef.current ||
      isSavingRef.current
    ) {
      return;
    }
    setDraftBranding(normalizeChurchBranding(branding));
    setBrandColorSlots(
      padBrandColorsToSlots(normalizeChurchBranding(branding).colors),
    );
    setFormError("");
  }, [branding, brandingStatus, liveBrandSerializedKey]);

  useEffect(
    () => () => {
      Object.values(logoPreviewUrls).forEach((url) => revokePreviewUrl(url));
    },
    [logoPreviewUrls],
  );

  const updateDraftBranding = useCallback(
    (updater: (current: ChurchBranding) => ChurchBranding) => {
      setDraftBranding((current) => updater(current));
      setFormError("");
    },
    [],
  );

  const onMissionChange = useCallback(
    (value: string) => {
      updateDraftBranding((current) => ({ ...current, mission: value }));
    },
    [updateDraftBranding],
  );

  const onVisionChange = useCallback(
    (value: string) => {
      updateDraftBranding((current) => ({ ...current, vision: value }));
    },
    [updateDraftBranding],
  );

  const updateLogoPreview = useCallback(
    (slot: BrandingLogoSlot, nextUrl: string | null) => {
      setLogoPreviewUrls((current) => {
        revokePreviewUrl(current[slot]);
        return {
          ...current,
          [slot]: nextUrl,
        };
      });
    },
    [],
  );

  const resetPendingLogos = useCallback(() => {
    setPendingLogoFiles(createEmptyPendingLogoFiles());
    setLogoPreviewUrls((current) => {
      Object.values(current).forEach((url) => revokePreviewUrl(url));
      return createEmptyLogoPreviewMap();
    });
  }, []);

  const handleLogoSelection = useCallback(
    (slot: BrandingLogoSlot, file?: File | null) => {
      if (!file) {
        return;
      }

      const extension = file.name.split(".").pop()?.trim().toLowerCase() || "";
      const isAllowedByExtension = ["png", "jpg", "jpeg", "webp", "svg"].includes(
        extension,
      );
      if (
        !BRANDING_ALLOWED_LOGO_TYPES.has(file.type) &&
        !isAllowedByExtension
      ) {
        setFormError(
          `${brandingLogoSlotContent[slot].title} must be PNG, JPG, WEBP, or SVG.`,
        );
        return;
      }

      if (file.size > MAX_LOGO_FILE_BYTES) {
        setFormError(
          `${brandingLogoSlotContent[slot].title} must be 5 MB or smaller.`,
        );
        return;
      }

      setPendingLogoFiles((current) => ({
        ...current,
        [slot]: file,
      }));
      updateLogoPreview(slot, URL.createObjectURL(file));
      setFormError("");
    },
    [updateLogoPreview],
  );

  const handleRemoveLogo = useCallback(
    (slot: BrandingLogoSlot) => {
      const input = logoFileInputRefs.current[slot];
      if (input) {
        input.value = "";
      }
      setPendingLogoFiles((current) => ({
        ...current,
        [slot]: null,
      }));
      updateLogoPreview(slot, null);
      updateDraftBranding((current) => ({
        ...current,
        logos: {
          ...current.logos,
          [slot]: null,
        },
      }));
    },
    [updateDraftBranding, updateLogoPreview],
  );

  const resetDraft = useCallback(() => {
    resetPendingLogos();
    const next = normalizeChurchBranding(branding);
    setDraftBranding(next);
    setBrandColorSlots(padBrandColorsToSlots(next.colors));
    setFormError("");
  }, [branding, resetPendingLogos]);

  const handleSave = useCallback(async () => {
    const validationMessage = getBrandingValidationMessage(mergedBranding);
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }
    const nextBaseBranding = normalizeChurchBranding(mergedBranding);

    setIsSaving(true);
    setFormError("");

    const previousBranding = normalizeChurchBranding(branding);
    const uploadedAssets: ChurchLogoAsset[] = [];

    try {
      const nextLogos: ChurchBranding["logos"] = {
        square: nextBaseBranding.logos.square ?? null,
        wide: nextBaseBranding.logos.wide ?? null,
      };

      for (const slot of ["square", "wide"] as BrandingLogoSlot[]) {
        const pendingFile = pendingLogoFiles[slot];
        if (!pendingFile) {
          continue;
        }

        const uploaded = await uploadImageToCloudinary(
          pendingFile,
          CLOUDINARY_UNSIGNED_UPLOAD_PRESET,
          CLOUDINARY_CLOUD_NAME,
        );
        const asset = toChurchLogoAsset(uploaded);
        uploadedAssets.push(asset);
        nextLogos[slot] = asset;
      }

      const nextBranding = normalizeChurchBranding({
        ...nextBaseBranding,
        logos: nextLogos,
      });

      await updateChurchBranding(churchId, nextBranding);
      setDraftBranding(nextBranding);
      setBrandColorSlots(padBrandColorsToSlots(nextBranding.colors));
      resetPendingLogos();
      showToast("Branding saved.", "success");

      const replacedAssets = (
        ["square", "wide"] as BrandingLogoSlot[]
      ).flatMap((slot) => {
        const previousLogo = previousBranding.logos[slot] || null;
        const nextLogo = nextBranding.logos[slot] || null;
        if (
          previousLogo?.publicId &&
          previousLogo.publicId !== nextLogo?.publicId
        ) {
          return [previousLogo];
        }
        return [];
      });

      void cleanupLogoAssets(replacedAssets);
    } catch (error) {
      await cleanupLogoAssets(uploadedAssets);
      const message = formatBrandingSaveError(error);
      setFormError(message);
      showToast(message, "error");
    } finally {
      setIsSaving(false);
    }
  }, [
    branding,
    churchId,
    mergedBranding,
    pendingLogoFiles,
    resetPendingLogos,
    showToast,
  ]);

  const patchBrandColorSlot = useCallback(
    (index: number, patch: Partial<ChurchBrandColor>) => {
      setBrandColorSlots((prev) => {
        const next = [...prev];
        const cur = next[index] ?? { value: "#FFFFFF", label: "" };
        next[index] = { ...cur, ...patch };
        return next;
      });
    },
    [],
  );

  const clearBrandColorSlot = useCallback((index: number) => {
    setBrandColorSlots((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
  }, []);

  const onChooseLogoFileClick = useCallback((slot: BrandingLogoSlot) => {
    logoFileInputRefs.current[slot]?.click();
  }, []);

  const onLogoFilePick = useCallback(
    (slot: BrandingLogoSlot, file: File | null) => {
      if (file) {
        handleLogoSelection(slot, file);
      }
    },
    [handleLogoSelection],
  );

  if (brandingStatus === "loading") {
    return (
      <section className="rounded-xl border border-gray-600 bg-gray-900/25 p-4">
        <div className="flex items-center gap-2 text-sm text-gray-200" role="status">
          <Spinner
            width="16px"
            borderWidth="2px"
            className="border-cyan-400/90 border-b-transparent"
          />
          <span>Loading branding…</span>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-600 bg-gray-900/25 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Branding</h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">
            Save your church logo, mission, vision, and brand colors for use across controllers.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="tertiary"
            svg={RotateCcw}
            iconSize="sm"
            disabled={!isDirty || isSaving}
            onClick={resetDraft}
          >
            Reset changes
          </Button>
          <Button
            variant="cta"
            svg={Save}
            iconSize="sm"
            isLoading={isSaving}
            disabled={isSaving || !isDirty}
            onClick={() => void handleSave()}
          >
            {isSaving ? "Saving branding..." : "Save branding"}
          </Button>
        </div>
      </div>

      <BrandingMissionVisionFields
        mission={draftBranding.mission}
        vision={draftBranding.vision}
        onMissionChange={onMissionChange}
        onVisionChange={onVisionChange}
      />

      <BrandingLogoSlotsSection
        logos={draftBranding.logos}
        pendingLogoFiles={pendingLogoFiles}
        logoPreviewUrls={logoPreviewUrls}
        logoFileInputRefs={logoFileInputRefs}
        onLogoFileChange={onLogoFilePick}
        onRemoveLogo={handleRemoveLogo}
        onChooseFileClick={onChooseLogoFileClick}
      />

      <BrandingColorSlotsSection
        brandColorSlots={brandColorSlots}
        patchBrandColorSlot={patchBrandColorSlot}
        clearBrandColorSlot={clearBrandColorSlot}
      />

      {formError ? (
        <p className="mt-4 text-sm text-red-400" role="alert">
          {formError}
        </p>
      ) : null}
    </section>
  );
});
