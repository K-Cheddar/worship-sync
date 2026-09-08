import { useContext, useEffect, useRef } from "react";
import { ToastContext } from "../../context/toastContext";
import { subscribeLocalVideoIssues } from "../../utils/localVideoIssues";

const DEDUPE_MS = 5_000;

const LocalVideoIssueManager = () => {
  const showToast = useContext(ToastContext)?.showToast;
  const lastIssueRef = useRef<{ key: string; shownAt: number } | undefined>(
    undefined,
  );

  useEffect(
    () =>
      subscribeLocalVideoIssues((issue) => {
        const key = `${issue.sourceId}\u0000${issue.detail}`;
        const now = Date.now();
        if (
          lastIssueRef.current?.key === key &&
          now - lastIssueRef.current.shownAt < DEDUPE_MS
        ) {
          return;
        }
        lastIssueRef.current = { key, shownAt: now };
        showToast?.(`Local video: ${issue.detail}`, "warning");
      }),
    [showToast],
  );

  return null;
};

export default LocalVideoIssueManager;
