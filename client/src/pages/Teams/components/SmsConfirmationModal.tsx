import Button from "../../../components/Button/Button";
import Modal from "../../../components/Modal/Modal";

type SmsConfirmationModalProps = {
  isOpen: boolean;
  recipientName: string;
  phoneNumberSnapshot: string;
  message: string;
  segmentCount: number;
  busy?: boolean;
  onCancel: () => void;
  onSend: () => void;
};

const SmsConfirmationModal = ({
  isOpen,
  recipientName,
  phoneNumberSnapshot,
  message,
  segmentCount,
  busy = false,
  onCancel,
  onSend,
}: SmsConfirmationModalProps) => (
  <Modal
    isOpen={isOpen}
    onClose={onCancel}
    title="Send this SMS?"
    description={`Review the SMS for ${recipientName} before sending.`}
    size="sm"
    busy={busy}
  >
    <div className="space-y-4 text-sm text-gray-200">
      <dl className="space-y-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Recipient</dt>
          <dd>{recipientName}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Phone number</dt>
          <dd>{phoneNumberSnapshot}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-gray-400">Message</dt>
          <dd className="whitespace-pre-wrap break-words">{message}</dd>
        </div>
      </dl>
      <p>{segmentCount} SMS segment{segmentCount === 1 ? "" : "s"}.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button disabled={busy} isLoading={busy} onClick={onSend}>Send</Button>
      </div>
    </div>
  </Modal>
);

export default SmsConfirmationModal;
