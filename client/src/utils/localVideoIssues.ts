const CHANNEL_NAME = "worshipsync-local-video-issues-v1";

export type LocalVideoIssue = {
  sourceId: string;
  detail: string;
  reportedAt: number;
};

let reporterChannel: BroadcastChannel | undefined;

export const reportLocalVideoIssue = (sourceId: string, detail: string) => {
  if (typeof BroadcastChannel === "undefined") return;
  reporterChannel ??= new BroadcastChannel(CHANNEL_NAME);
  reporterChannel.postMessage({
    sourceId,
    detail,
    reportedAt: Date.now(),
  } satisfies LocalVideoIssue);
};

export const subscribeLocalVideoIssues = (
  onIssue: (issue: LocalVideoIssue) => void,
) => {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const onMessage = (event: MessageEvent<unknown>) => {
    const issue = event.data as Partial<LocalVideoIssue>;
    if (
      typeof issue.sourceId === "string" &&
      typeof issue.detail === "string" &&
      typeof issue.reportedAt === "number"
    ) {
      onIssue(issue as LocalVideoIssue);
    }
  };
  channel.addEventListener("message", onMessage);
  return () => channel.close();
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    reporterChannel?.close();
    reporterChannel = undefined;
  });
}
