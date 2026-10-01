import { getPublicBoardRouteKind } from "./publicSharePathRedirect";

export const BOOTSTRAP_RELOAD_FLAG = "worshipsync:bootstrap-chunk-reload";
export const BOOTSTRAP_RETRY_DELAY_MS = 300;

export type BootstrapFailureStage =
  | "first failure"
  | "retry failure"
  | "post-reload failure"
  | "post-reload retry failure";

type BootstrapModule<T> = { default: T };
type BootstrapLoadResult<T> =
  | { status: "loaded"; module: BootstrapModule<T> }
  | {
      status: "failed";
      error: unknown;
      stage: BootstrapFailureStage;
    };

type BootstrapStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type LoadBootstrapOptions = {
  reload?: () => void;
  storage?: BootstrapStorage;
  wait?: (ms: number) => Promise<void>;
  onFailure?: (
    stage: BootstrapFailureStage,
    error: unknown,
    previousError?: unknown,
  ) => void | Promise<void>;
  retryDelayMs?: number;
};

const getSessionStorage = (): BootstrapStorage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const readReloadMarker = (storage: BootstrapStorage | null): boolean | null => {
  if (!storage) return null;
  try {
    return storage.getItem(BOOTSTRAP_RELOAD_FLAG) === "1";
  } catch {
    return null;
  }
};

const clearReloadMarker = (storage: BootstrapStorage | null): void => {
  try {
    storage?.removeItem(BOOTSTRAP_RELOAD_FLAG);
  } catch {
    // A stale marker only disables another automatic reload, which is safe.
  }
};

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

const defaultReload = (): void => window.location.reload();

/** Keep this intentionally narrow: only recognizable module/chunk fetch failures recover automatically. */
export const isModuleLoadError = (error: unknown): boolean => {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : "";

  return /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module|failed to load module script|loading chunk [\w-]+ failed|chunkloaderror|module script load failed/i.test(
    message,
  );
};

/** Normalize public routes with opaque IDs before putting paths in diagnostic context. */
export const normalizeBootstrapPathname = (pathname: string): string => {
  const publicPathPatterns: Array<[RegExp, string]> = [
    [/^\/teams\/schedule\/[^/]+\/?$/, "/teams/schedule/:token"],
    [/^\/teams\/intake\/[^/]+\/?$/, "/teams/intake/:token"],
    [/^\/sms-opt-in\/[^/]+\/?$/, "/sms-opt-in/:churchId"],
    [/^\/services\/[^/]+\/?$/, "/services/:shareId"],
    [/^\/schedule-response\/[^/]+\/?$/, "/schedule-response/:token"],
    [/^\/a\/[^/]+\/?$/, "/a/:token"],
  ];

  const boardRouteKind = getPublicBoardRouteKind(pathname);
  if (boardRouteKind === "present") return "/boards/present/:aliasId";
  if (boardRouteKind === "board") return "/boards/:aliasId";

  return (
    publicPathPatterns.find(([pattern]) => pattern.test(pathname))?.[1] ??
    pathname
  );
};

export const loadBootstrapModule = async <T>(
  load: () => Promise<BootstrapModule<T>>,
  options: LoadBootstrapOptions = {},
): Promise<BootstrapLoadResult<T>> => {
  const storage = options.storage ?? getSessionStorage();
  const reloadAlreadyAttempted = readReloadMarker(storage);
  const wait = options.wait ?? defaultWait;
  const reportFailure = async (
    stage: BootstrapFailureStage,
    error: unknown,
    previousError?: unknown,
  ) => {
    try {
      await options.onFailure?.(stage, error, previousError);
    } catch {
      // Diagnostics must never prevent the visible bootstrap recovery path.
    }
  };

  let firstError: unknown;
  try {
    const module = await load();
    clearReloadMarker(storage);
    return { status: "loaded", module };
  } catch (error) {
    firstError = error;
    const firstStage = reloadAlreadyAttempted
      ? "post-reload failure"
      : "first failure";
    await reportFailure(firstStage, error);
    if (!isModuleLoadError(error)) {
      return { status: "failed", error, stage: firstStage };
    }
  }

  await wait(options.retryDelayMs ?? BOOTSTRAP_RETRY_DELAY_MS);

  try {
    const module = await load();
    clearReloadMarker(storage);
    return { status: "loaded", module };
  } catch (error) {
    const retryStage = reloadAlreadyAttempted
      ? "post-reload retry failure"
      : "retry failure";
    await reportFailure(retryStage, error, firstError);
    if (
      !isModuleLoadError(error) ||
      reloadAlreadyAttempted !== false ||
      !storage
    ) {
      return { status: "failed", error, stage: retryStage };
    }

    try {
      storage.setItem(BOOTSTRAP_RELOAD_FLAG, "1");
    } catch {
      // Without a durable guard, automatic reload could loop forever.
      return { status: "failed", error, stage: retryStage };
    }

    try {
      (options.reload ?? defaultReload)();
    } catch {
      // If navigation is unavailable, return the failure so the recovery UI renders.
    }
    return { status: "failed", error, stage: retryStage };
  }
};

export const loadSelectedBootstrapModule = <TPublic, TOperator>(
  isPublic: boolean,
  loaders: {
    public: () => Promise<BootstrapModule<TPublic>>;
    operator: () => Promise<BootstrapModule<TOperator>>;
  },
  options: LoadBootstrapOptions = {},
): Promise<BootstrapLoadResult<TPublic | TOperator>> => {
  const selectedLoader: () => Promise<BootstrapModule<TPublic | TOperator>> =
    isPublic
      ? async () => loaders.public()
      : async () => loaders.operator();
  return loadBootstrapModule(selectedLoader, options);
};
