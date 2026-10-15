import { useState } from "react";
import Button from "../components/Button/Button";
import type { StaleBoardSessionScope } from "./boardUtils";

type BoardSessionFreshStartSuggestionProps = {
  scope: StaleBoardSessionScope;
  onKeep: () => Promise<void>;
  onStart: () => void;
};

const BoardSessionFreshStartSuggestion = ({
  scope,
  onKeep,
  onStart,
}: BoardSessionFreshStartSuggestionProps) => {
  const [isKeeping, setIsKeeping] = useState(false);
  const subject =
    scope === "both"
      ? "The discussion board and Restream session"
      : scope === "board"
        ? "The discussion board"
        : "The Restream session";
  const startLabel =
    scope === "both" || scope === "board"
      ? "Start fresh for today"
      : "Start new Restream session";
  const keepLabel = scope === "both" ? "Keep current session" : "Keep current";

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-sky-300/30 bg-sky-950/30 p-3 sm:flex-row sm:items-center sm:justify-between"
      role="status"
      aria-live="polite"
    >
      <div>
        <p className="text-sm font-semibold text-sky-50">
          {subject} is from an earlier day and has no activity today.
        </p>
        <p className="mt-1 text-xs text-sky-100/80">
          Choose whether to keep this session or start a fresh one.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 sm:shrink-0">
        <Button
          variant="secondary"
          disabled={isKeeping}
          onClick={() => {
            setIsKeeping(true);
            void onKeep().finally(() => setIsKeeping(false));
          }}
        >
          {isKeeping ? "Keeping…" : keepLabel}
        </Button>
        <Button variant="primary" onClick={onStart} disabled={isKeeping}>
          {startLabel}
        </Button>
      </div>
    </section>
  );
};

export default BoardSessionFreshStartSuggestion;
