import Modal from "../../components/Modal/Modal";
import Button from "../../components/Button/Button";

type MediaProviderRetryModalProps = {
  isOpen: boolean;
  failedCount: number;
  isRetrying: boolean;
  onRetry: () => void;
  onDismiss: () => void;
};

const MediaProviderRetryModal = ({
  isOpen,
  failedCount,
  isRetrying,
  onRetry,
  onDismiss,
}: MediaProviderRetryModalProps) => {
  const noun = failedCount === 1 ? "file" : "files";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onDismiss}
      title="Media cleanup"
      size="sm"
      busy={isRetrying}
      contentPadding="p-4"
      zIndexLevel={2}
      description="Some backing files could not be removed after the media was deleted from your library."
    >
      <p className="text-lg text-white mb-4">
        {failedCount} backing {noun} could not be removed. The media was
        deleted from your library.
      </p>
      <div className="flex gap-4 w-full">
        <Button
          className="flex-1 justify-center"
          onClick={onDismiss}
          disabled={isRetrying}
        >
          Dismiss
        </Button>
        <Button
          className="flex-1 justify-center"
          onClick={onRetry}
          disabled={isRetrying}
        >
          {isRetrying ? "Retrying…" : "Retry"}
        </Button>
      </div>
    </Modal>
  );
};

export default MediaProviderRetryModal;
