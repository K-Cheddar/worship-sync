const READ_ONLY_REALTIME_ACTIONS = new Set([
  "q", // listen
  "n", // unlisten
  "g", // one-time get
  "auth",
  "gauth",
  "unauth",
  "appcheck",
  "unappeck",
  "s", // connection stats
  "echo",
]);

const WRITE_REALTIME_ACTIONS = new Set([
  "p", // put / set / remove
  "m", // merge / update
  "o", // onDisconnect put / remove
  "om", // onDisconnect merge
  "oc", // cancel onDisconnect
]);

export type ControllerFirebaseRequestDecision = {
  action: "allow" | "block" | "ignore";
  reason?: "http_write_method" | "long_poll_write" | "unknown_long_poll_action";
};

const isRealtimeDatabaseHost = (hostname: string) => {
  const host = hostname.toLowerCase();
  return host === "firebaseio.com" ||
    host.endsWith(".firebaseio.com") ||
    host === "firebasedatabase.app" ||
    host.endsWith(".firebasedatabase.app");
};

export const isRealtimeDatabaseUrl = (rawUrl: string | URL) => {
  let url: URL;
  try {
    url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
  } catch {
    return false;
  }

  const path = url.pathname.toLowerCase();
  return isRealtimeDatabaseHost(url.hostname) ||
    /(?:^|\/)\.lp$/.test(path) ||
    /(?:^|\/)\.ws$/.test(path) ||
    path.endsWith(".json");
};

export const isLongPollingWritePacket = (rawUrl: string | URL) => {
  let url: URL;
  try {
    url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
  } catch {
    return false;
  }
  if (!/(?:^|\/)\.lp$/i.test(url.pathname)) return false;
  return [...url.searchParams.keys()].some((key) => /^d\d*$/i.test(key));
};

const decodeRealtimeAction = (payload: string) => {
  try {
    const base64 = payload.replace(/\./g, "=").replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(base64, "base64").toString("utf8");
    const complete = JSON.parse(decoded) as { d?: { a?: unknown } };
    if (typeof complete?.d?.a === "string") return complete.d.a;
  } catch {
    // A long-poll segment can end partway through its JSON packet. Its action
    // is serialized before the potentially large payload, so inspect only the
    // packet header below without retaining or logging the payload.
  }

  const decoded = Buffer.from(
    payload.replace(/\./g, "=").replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
  const action = /^\s*\{\s*"t"\s*:\s*"d"\s*,\s*"d"\s*:\s*\{\s*"r"\s*:\s*\d+\s*,\s*"a"\s*:\s*"([^"\\]+)"/.exec(decoded)?.[1];
  return action ?? null;
};

/**
 * Firebase's long-poll transport sends both subscription commands and writes
 * in GET query parameters. Allow only known read/auth protocol actions and
 * reject mutations before the request reaches Firebase.
 */
export class ControllerFirebaseWriteFirewall {
  private readonly segmentActions = new Map<string, Map<number, "read" | "write">>();

  inspectRequest(method: string, rawUrl: string): ControllerFirebaseRequestDecision {
    if (!isRealtimeDatabaseUrl(rawUrl)) return { action: "ignore" };

    if (method.toUpperCase() !== "GET") {
      return { action: "block", reason: "http_write_method" };
    }

    const url = new URL(rawUrl);
    if (!/(?:^|\/)\.lp$/i.test(url.pathname) || !isLongPollingWritePacket(url)) {
      return { action: "allow" };
    }

    const sessionId = url.searchParams.get("id") ?? "unknown-session";
    let actionsBySegment = this.segmentActions.get(sessionId);
    if (!actionsBySegment) {
      actionsBySegment = new Map();
      this.segmentActions.set(sessionId, actionsBySegment);
    }

    const segments = [...url.searchParams.entries()]
      .flatMap(([key, payload]) => {
        const match = /^d(\d*)$/i.exec(key);
        if (!match) return [];
        const index = match[1] ? Number(match[1]) : 0;
        const sequence = Number(url.searchParams.get(`seg${index}`) ?? index);
        const total = Number(url.searchParams.get(`ts${index}`) ?? 1);
        return [{ index, sequence, total, payload }];
      })
      .sort((a, b) => a.index - b.index);

    if (segments.length === 0) return { action: "allow" };

    let blocked = false;
    let unknown = false;
    for (const segment of segments) {
      const decodedAction = decodeRealtimeAction(segment.payload);
      let disposition: "read" | "write" | undefined;
      if (decodedAction && READ_ONLY_REALTIME_ACTIONS.has(decodedAction)) {
        disposition = "read";
      } else if (decodedAction && WRITE_REALTIME_ACTIONS.has(decodedAction)) {
        disposition = "write";
      } else if (decodedAction) {
        disposition = "write"; // Unknown commands fail closed.
        unknown = true;
      } else {
        disposition = actionsBySegment.get(segment.sequence);
      }

      if (!disposition) {
        blocked = true;
        unknown = true;
        continue;
      }

      const endSequence = segment.sequence + Math.max(1, segment.total) - 1;
      for (let sequence = segment.sequence; sequence <= endSequence; sequence++) {
        actionsBySegment.set(sequence, disposition);
      }
      if (disposition === "write") blocked = true;
    }

    // Bound this test-only cache if a long-lived browser happens to reconnect
    // many times. Only segment classifications are retained, never payloads.
    if (actionsBySegment.size > 2_000) {
      const recent = [...actionsBySegment.entries()].slice(-1_000);
      actionsBySegment.clear();
      for (const [sequence, action] of recent) actionsBySegment.set(sequence, action);
    }

    return blocked
      ? { action: "block", reason: unknown ? "unknown_long_poll_action" : "long_poll_write" }
      : { action: "allow" };
  }
}

export type ControllerIsolationInstallation = {
  networkGuardInstalled?: boolean;
  sdkWriteBoundaryInstalled?: boolean;
  longPollingConfigured?: boolean;
  writeCapabilitiesDisabled?: boolean;
  databaseUrlSupported?: boolean;
};

export const assertControllerIsolationInstalled = (
  installation: ControllerIsolationInstallation | null | undefined,
) => {
  if (
    installation?.networkGuardInstalled !== true ||
    installation.sdkWriteBoundaryInstalled !== true ||
    installation.longPollingConfigured !== true ||
    installation.writeCapabilitiesDisabled !== true
  ) {
    throw new Error(
      "Controller E2E Firebase isolation is incomplete; refusing to start or mutate fixtures.",
    );
  }
};

export const assertControllerFirebaseTargetSupported = (
  installation: ControllerIsolationInstallation | null | undefined,
) => {
  assertControllerIsolationInstalled(installation);
  if (installation?.databaseUrlSupported !== true) {
    throw new Error(
      "Controller E2E Firebase isolation cannot verify the configured Realtime Database target; refusing to start or mutate fixtures.",
    );
  }
};
