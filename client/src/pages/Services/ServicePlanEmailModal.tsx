import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Check, RotateCcw, Send, X } from "lucide-react";
import type {
  ServicePlanShareEmailResult,
  ServicePlanShareVersion,
} from "../../api/auth";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Modal from "../../components/Modal/Modal";
import SegmentedControl from "../../components/SegmentedControl/SegmentedControl";
import { getApiErrorMessage } from "../../utils/apiErrorToast";
import { isValidEmailFormat } from "../../utils/emailFormat";
import {
  readLastServicePlanEmailMessage,
  readRecentServicePlanEmailRecipients,
  rememberLastServicePlanEmailMessage,
  rememberServicePlanEmailRecipients,
} from "./servicePlanEmailPreferences";

export type ServicePlanEmailDraft = {
  recipients: string[];
  subject: string;
  message: string;
  shareVersion: ServicePlanShareVersion;
};

type ServicePlanEmailModalProps = {
  serviceName: string;
  dateLabel: string;
  initialShareVersion: ServicePlanShareVersion;
  onClose: () => void;
  onSend: (
    draft: ServicePlanEmailDraft,
  ) => Promise<ServicePlanShareEmailResult>;
};

const MAX_SERVICE_PLAN_EMAIL_SUBJECT_LENGTH = 200;

const createDefaultSubject = (serviceName: string, dateLabel: string) => {
  const suffix = ` Service Plan — ${dateLabel}`;
  const fullSubject = `${serviceName}${suffix}`;
  if (fullSubject.length <= MAX_SERVICE_PLAN_EMAIL_SUBJECT_LENGTH) {
    return fullSubject;
  }
  const ellipsis = "…";
  const serviceNameLength = Math.max(
    0,
    MAX_SERVICE_PLAN_EMAIL_SUBJECT_LENGTH - suffix.length - ellipsis.length,
  );
  return `${serviceName.slice(0, serviceNameLength)}${ellipsis}${suffix}`.slice(
    0,
    MAX_SERVICE_PLAN_EMAIL_SUBJECT_LENGTH,
  );
};

const formatRecipientCount = (count: number) =>
  `${count} recipient${count === 1 ? "" : "s"}`;

const parseRecipientText = (value: string) =>
  value.split(/[,;\n]/).map((recipient) => recipient.trim()).filter(Boolean);

const addUniqueRecipients = (current: string[], additions: string[]) => {
  const existing = new Set(current.map((recipient) => recipient.toLowerCase()));
  return [
    ...current,
    ...additions.filter((recipient) => {
      const normalized = recipient.toLowerCase();
      if (existing.has(normalized)) return false;
      existing.add(normalized);
      return true;
    }),
  ];
};

const ServicePlanEmailModal = ({
  serviceName,
  dateLabel,
  initialShareVersion,
  onClose,
  onSend,
}: ServicePlanEmailModalProps) => {
  const serviceDisplay = serviceName.trim() || "Service";
  const dateDisplay = dateLabel.trim() || "the scheduled date";
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState("");
  const [recentRecipients] = useState(readRecentServicePlanEmailRecipients);
  const [recipientError, setRecipientError] = useState("");
  const [isRecipientFocused, setIsRecipientFocused] = useState(false);
  const [subject, setSubject] = useState(
    createDefaultSubject(serviceDisplay, dateDisplay),
  );
  const [message, setMessage] = useState(
    () =>
      readLastServicePlanEmailMessage() ||
      `Here is the service plan for ${serviceDisplay} on ${dateDisplay}.`,
  );
  const [shareVersion, setShareVersion] = useState<ServicePlanShareVersion>(
    initialShareVersion,
  );
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "partial" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [sentRecipients, setSentRecipients] = useState<string[]>([]);
  const sendInFlightRef = useRef(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sendInFlightRef.current || status === "sent") return;

    const pendingRecipients = parseRecipientText(recipientInput);
    const allRecipients = addUniqueRecipients(recipients, pendingRecipients);
    if (
      allRecipients.length === 0 ||
      pendingRecipients.some((recipient) => !isValidEmailFormat(recipient))
    ) {
      setStatus("error");
      setErrorMessage("Enter one or more valid email addresses.");
      return;
    }
    if (!subject.trim()) {
      setStatus("error");
      setErrorMessage("Enter a subject.");
      return;
    }
    if (!message.trim()) {
      setStatus("error");
      setErrorMessage("Enter a message.");
      return;
    }

    sendInFlightRef.current = true;
    setStatus("sending");
    setErrorMessage("");
    setStatusMessage("");
    try {
      const result = await onSend({
        recipients: allRecipients,
        subject: subject.trim(),
        message: message.trim(),
        shareVersion,
      });
      const failedRecipientSet = new Set(result.failedRecipients.map((recipient) => recipient.toLowerCase()));
      const successfulRecipients = allRecipients.filter(
        (recipient) => !failedRecipientSet.has(recipient.toLowerCase()),
      );
      if (successfulRecipients.length > 0) {
        rememberServicePlanEmailRecipients(successfulRecipients);
        rememberLastServicePlanEmailMessage(message);
      }
      setSentRecipients((previous) =>
        Array.from(new Set([...previous, ...successfulRecipients])),
      );
      if (result.failedRecipients.length > 0) {
        setRecipients(result.failedRecipients);
        setRecipientInput("");
        setStatus("partial");
        setStatusMessage(
          `Sent to ${formatRecipientCount(result.sent)}. Could not send to ${formatRecipientCount(result.failedRecipients.length)}. Only failed addresses remain so you can retry them without resending successful emails.`,
        );
      } else {
        setStatus("sent");
      }
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        getApiErrorMessage(error, "Could not send this email. Try again in a moment."),
      );
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const isSending = status === "sending";
  const isSent = status === "sent";
  const shareVersionLabel = shareVersion === "detailed" ? "detailed" : "simple";
  const suggestions = recentRecipients.filter(
    (recipient) =>
      !recipients.some((current) => current.toLowerCase() === recipient.toLowerCase()) &&
      recipient.toLowerCase().includes(recipientInput.trim().toLowerCase()),
  );

  const commitRecipientText = (raw: string) => {
    const parts = parseRecipientText(raw);
    const valid = parts.filter(isValidEmailFormat);
    const invalid = parts.filter((part) => !isValidEmailFormat(part));
    if (valid.length > 0) setRecipients((current) => addUniqueRecipients(current, valid));
    setRecipientInput(invalid.length > 0 ? invalid.join(", ") : "");
    setRecipientError(invalid.length > 0 ? "Enter a valid email address before sending." : "");
  };

  const handleRecipientChange = (value: string) => {
    setRecipientError("");
    if (/[;,\n]/.test(value)) {
      commitRecipientText(value);
    } else {
      setRecipientInput(value);
    }
  };

  const handleRecipientKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "Tab") {
      const value = recipientInput.trim();
      if (value) {
        if (event.key === "Enter") event.preventDefault();
        commitRecipientText(value);
      }
    } else if (event.key === "Backspace" && !recipientInput && recipients.length > 0) {
      event.preventDefault();
      setRecipients((current) => current.slice(0, -1));
    }
  };

  const handleRecipientPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!/[;,\n]/.test(pasted)) return;
    event.preventDefault();
    commitRecipientText(pasted);
  };
  let submitLabel = "Send email";
  if (isSending) submitLabel = "Sending…";
  else if (status === "partial") submitLabel = "Retry failed emails";

  return (
    <Modal
      isOpen
      onClose={isSending ? () => undefined : onClose}
      title="Email service plan"
      showCloseButton={!isSending}
      size="sm"
    >
      {isSent ? (
        <div className="space-y-4" role="status" aria-live="polite">
          <p className="text-sm text-green-200">
            Service plan email sent successfully to {sentRecipients.join(", ")}.
          </p>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              svg={Check}
              onClick={onClose}
            >
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <p className="text-sm text-gray-300">
            Send the current {shareVersionLabel} service plan link. Later edits
            will be reflected when recipients open it.
          </p>
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-gray-100">
              Plan version
            </span>
            <SegmentedControl
              options={[
                { value: "detailed", label: "Detailed" },
                { value: "simple", label: "Simple" },
              ]}
              value={shareVersion}
              onChange={setShareVersion}
              ariaLabel="Plan version"
              variant="compact"
              disabled={isSending}
            />
          </div>
          {status === "partial" ? (
            <p className="text-sm text-amber-200" role="status" aria-live="polite">
              {statusMessage}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <label htmlFor="service-plan-email-recipients" className="block text-sm font-medium text-gray-100">To</label>
            <div className="relative">
              <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-gray-600 bg-gray-950/60 px-2 py-1.5 focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500">
                {recipients.map((recipient) => (
                  <span key={recipient} className="inline-flex max-w-full items-center gap-1 rounded-full bg-gray-700 px-2 py-0.5 text-sm text-gray-100">
                    <span className="max-w-[16rem] truncate">{recipient}</span>
                    <button type="button" className="rounded-full text-gray-300 hover:text-white" aria-label={`Remove ${recipient}`} onClick={() => setRecipients((current) => current.filter((value) => value !== recipient))} disabled={isSending}>×</button>
                  </span>
                ))}
                <input
                  id="service-plan-email-recipients"
                  type="text"
                  className="min-w-40 flex-1 bg-transparent py-1 text-sm text-gray-100 outline-none placeholder:text-gray-500 disabled:cursor-not-allowed"
                  placeholder={recipients.length === 0 ? "person@example.com" : "Add another recipient"}
                  value={recipientInput}
                  disabled={isSending}
                  autoComplete="email"
                  aria-describedby={recipientError ? "service-plan-email-recipient-error" : undefined}
                  onChange={(event) => handleRecipientChange(event.target.value)}
                  onKeyDown={handleRecipientKeyDown}
                  onPaste={handleRecipientPaste}
                  onFocus={() => {
                    setRecipientError("");
                    setIsRecipientFocused(true);
                  }}
                  onBlur={() => setIsRecipientFocused(false)}
                />
              </div>
              {suggestions.length > 0 && isRecipientFocused && !isSending ? (
                <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-600 bg-gray-900 p-1 shadow-xl" role="listbox" aria-label="Recent email recipients">
                  {suggestions.map((recipient) => (
                    <button key={recipient} type="button" role="option" aria-selected="false" className="block w-full rounded px-2 py-1.5 text-left text-sm text-gray-100 hover:bg-gray-700" onMouseDown={(event) => event.preventDefault()} onClick={() => { setRecipients((current) => addUniqueRecipients(current, [recipient])); setRecipientInput(""); }}>
                      {recipient}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {recipientError ? <p id="service-plan-email-recipient-error" className="text-sm text-red-200" role="alert">{recipientError}</p> : null}
          </div>
          <Input
            id="service-plan-email-subject"
            label="Subject"
            labelClassName="text-gray-100"
            value={subject}
            maxLength={200}
            disabled={isSending}
            onChange={(value) => setSubject(String(value))}
          />
          <div className="space-y-1.5">
            <label
              htmlFor="service-plan-email-message"
              className="block text-sm font-medium text-gray-100"
            >
              Message
            </label>
            <textarea
              id="service-plan-email-message"
              className="min-h-28 w-full resize-y rounded-md border border-gray-600 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-65"
              value={message}
              maxLength={5000}
              disabled={isSending}
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>
          {status === "error" ? (
            <p className="text-sm text-red-200" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="tertiary"
              svg={X}
              disabled={isSending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="cta"
              svg={status === "partial" ? RotateCcw : Send}
              disabled={isSending}
            >
              {submitLabel}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default ServicePlanEmailModal;
