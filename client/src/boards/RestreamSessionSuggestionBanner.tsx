import { useCallback, useState } from "react";
import Button from "../components/Button/Button";
import type { RestreamSessionSuggestion } from "../types";
import {
  keepCurrentRestreamSession,
  resetRestreamSession,
} from "./api";

type RestreamSessionSuggestionBannerProps = {
  churchId: string;
  suggestion: RestreamSessionSuggestion | null | undefined;
  onResolved: () => Promise<void> | void;
  showToast?: (message: string, variant: "success" | "error") => void;
};

const RestreamSessionSuggestionBanner = ({
  churchId,
  suggestion,
  onResolved,
  showToast,
}: RestreamSessionSuggestionBannerProps) => {
  const [isActing, setIsActing] = useState(false);

  const run = useCallback(
    async (action: () => Promise<void>, successMessage: string) => {
      if (!churchId || isActing) return;
      setIsActing(true);
      try {
        await action();
        await onResolved();
        showToast?.(successMessage, "success");
      } catch (error) {
        showToast?.(
          error instanceof Error
            ? error.message
            : "Could not update the Restream session.",
          "error",
        );
      } finally {
        setIsActing(false);
      }
    },
    [churchId, isActing, onResolved, showToast],
  );

  if (!churchId || !suggestion?.message) return null;

  return (
    <div
      className="rounded-lg border border-sky-300/25 bg-sky-950/25 p-3"
      role="status"
      aria-live="polite"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-100/90">
        Restream session
      </p>
      <p className="mt-1 text-sm text-sky-50">{suggestion.message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="primary"
          className="cursor-pointer"
          disabled={isActing}
          onClick={() =>
            void run(
              async () => {
                await keepCurrentRestreamSession(churchId);
              },
              "Keeping the current Restream chat.",
            )
          }
        >
          Keep current chat
        </Button>
        <Button
          variant="secondary"
          className="cursor-pointer"
          disabled={isActing}
          onClick={() =>
            void run(
              async () => {
                await resetRestreamSession(churchId);
              },
              "Started a new Restream session.",
            )
          }
        >
          Start new Restream session
        </Button>
      </div>
    </div>
  );
};

export default RestreamSessionSuggestionBanner;
