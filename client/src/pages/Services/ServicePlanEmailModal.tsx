import { useRef, useState } from "react";
import type { ServicePlanShareEmailResult } from "../../api/auth";
import Button from "../../components/Button/Button";
import Input from "../../components/Input/Input";
import Modal from "../../components/Modal/Modal";
import { getApiErrorMessage } from "../../utils/apiErrorToast";
import { isValidEmailFormat } from "../../utils/emailFormat";

export type ServicePlanEmailDraft = {
  recipients: string[];
  subject: string;
  message: string;
};

type ServicePlanEmailModalProps = {
  serviceName: string;
  dateLabel: string;
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

const parseRecipients = (value: string) =>
  value
    .split(/[,;\n]/)
    .map((recipient) => recipient.trim())
    .filter(Boolean);

const ServicePlanEmailModal = ({
  serviceName,
  dateLabel,
  onClose,
  onSend,
}: ServicePlanEmailModalProps) => {
  const serviceDisplay = serviceName.trim() || "Service";
  const dateDisplay = dateLabel.trim() || "the scheduled date";
  const [recipientInput, setRecipientInput] = useState("");
  const [subject, setSubject] = useState(
    createDefaultSubject(serviceDisplay, dateDisplay),
  );
  const [message, setMessage] = useState(
    `Here is the service plan for ${serviceDisplay} on ${dateDisplay}.`,
  );
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "partial" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const sendInFlightRef = useRef(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sendInFlightRef.current || status === "sent") return;

    const recipients = parseRecipients(recipientInput);
    if (
      recipients.length === 0 ||
      recipients.some((recipient) => !isValidEmailFormat(recipient))
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
        recipients,
        subject: subject.trim(),
        message: message.trim(),
      });
      if (result.failedRecipients.length > 0) {
        setRecipientInput(result.failedRecipients.join(", "));
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
            Service plan email sent successfully.
          </p>
          <div className="flex justify-end">
            <Button type="button" variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <p className="text-sm text-gray-300">
            Send the current shared plan link. Later edits to the plan will be
            reflected when recipients open it.
          </p>
          {status === "partial" ? (
            <p className="text-sm text-amber-200" role="status" aria-live="polite">
              {statusMessage}
            </p>
          ) : null}
          <Input
            id="service-plan-email-recipients"
            label="To"
            labelClassName="text-gray-100"
            placeholder="person@example.com, another@example.com"
            value={recipientInput}
            disabled={isSending}
            autoComplete="email"
            onChange={(value) => setRecipientInput(String(value))}
          />
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
              disabled={isSending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSending}>
              {submitLabel}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default ServicePlanEmailModal;
