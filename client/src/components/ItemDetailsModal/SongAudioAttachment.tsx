import { Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SongAudio } from "../../types";
import Button from "../Button/Button";
import SongAudioPlayer from "../SongAudioPlayer/SongAudioPlayer";

type SongAudioAttachmentProps = {
  audio: SongAudio | undefined;
  disabled: boolean;
  onUpload: (file: File) => Promise<void>;
  onGetUrl: (disposition: "inline" | "attachment") => Promise<string>;
  onRemove: () => Promise<void>;
};

const getMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export default function SongAudioAttachment({
  audio,
  disabled,
  onUpload,
  onGetUrl,
  onRemove,
}: SongAudioAttachmentProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    setIsConfirmingRemoval(false);
  }, [audio?.id]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError("");
    setIsUploading(true);
    try {
      await onUpload(file);
    } catch (uploadError) {
      setError(getMessage(uploadError, "The MP3 could not be uploaded. Try again."));
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = async () => {
    setError("");
    setIsRemoving(true);
    try {
      await onRemove();
    } catch (removeError) {
      setError(getMessage(removeError, "The MP3 could not be removed. Try again."));
    } finally {
      setIsRemoving(false);
      setIsConfirmingRemoval(false);
    }
  };

  return (
    <section className="border-t border-gray-700 pt-3" aria-label="Song audio">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">Reference MP3</p>
          <p className="text-xs text-gray-400">Private to your church.</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mpeg,.mp3"
          className="sr-only"
          aria-label="Choose MP3"
          onChange={handleFileChange}
          disabled={disabled || isUploading}
        />
        <Button
          variant="secondary"
          className="text-sm"
          svg={Upload}
          disabled={disabled || isUploading}
          isLoading={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {audio ? "Replace" : "Attach MP3"}
        </Button>
      </div>

      {audio ? (
        <div className="mt-2">
          <SongAudioPlayer audio={audio} onGetUrl={onGetUrl} />
          <div className="mt-2 flex flex-wrap gap-2">
            {isConfirmingRemoval ? (
              <>
                <Button
                  variant="destructive"
                  className="text-sm"
                  disabled={isRemoving}
                  isLoading={isRemoving}
                  onClick={handleRemove}
                >
                  Remove MP3
                </Button>
                <Button
                  variant="tertiary"
                  className="text-sm"
                  disabled={isRemoving}
                  onClick={() => setIsConfirmingRemoval(false)}
                >
                  Keep
                </Button>
              </>
            ) : (
              <Button
                variant="tertiary"
                className="text-sm text-red-300"
                svg={Trash2}
                onClick={() => setIsConfirmingRemoval(true)}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-gray-400">No MP3 attached.</p>
      )}

      {error ? <p className="mt-2 text-sm text-red-400" role="alert">{error}</p> : null}
    </section>
  );
}
