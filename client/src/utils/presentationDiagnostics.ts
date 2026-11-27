export type PresentationDiagnostic = {
  at: number;
  event: string;
  outputId?: string;
  itemId?: string;
  slideIndex?: number;
  reason?: string;
  source?: "firebase" | "storage" | "local";
};

const HISTORY_LIMIT = 256;
const history: Array<PresentationDiagnostic | undefined> =
  new Array(HISTORY_LIMIT);
let historyStart = 0;
let historySize = 0;

export const recordPresentationDiagnostic = (
  event: Omit<PresentationDiagnostic, "at"> & { at?: number },
) => {
  const entry: PresentationDiagnostic = {
    ...event,
    at: event.at ?? Date.now(),
  };
  const index = (historyStart + historySize) % HISTORY_LIMIT;
  history[index] = entry;
  if (historySize < HISTORY_LIMIT) {
    historySize += 1;
  } else {
    historyStart = (historyStart + 1) % HISTORY_LIMIT;
  }
  return entry;
};

export const getPresentationDiagnostics = () =>
  Array.from({ length: historySize }, (_, index) =>
    history[(historyStart + index) % HISTORY_LIMIT],
  ).filter((entry): entry is PresentationDiagnostic => Boolean(entry));

export const clearPresentationDiagnostics = () => {
  history.fill(undefined);
  historyStart = 0;
  historySize = 0;
};

declare global {
  interface Window {
    __WORSHIPSYNC_PRESENTATION_DIAGNOSTICS__?: {
      getEvents: typeof getPresentationDiagnostics;
      clear: typeof clearPresentationDiagnostics;
    };
  }
}

if (typeof window !== "undefined") {
  window.__WORSHIPSYNC_PRESENTATION_DIAGNOSTICS__ ??= {
    getEvents: getPresentationDiagnostics,
    clear: clearPresentationDiagnostics,
  };
}
