type PresentationSyncErrorHandler = (message: string) => void;

const handlers = new Set<PresentationSyncErrorHandler>();

export const registerPresentationSyncErrorHandler = (
  handler: PresentationSyncErrorHandler,
) => {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
};

export const notifyPresentationSyncError = (message: string) => {
  handlers.forEach((handler) => {
    try {
      handler(message);
    } catch {
      // A toast failure must not interfere with the presentation action.
    }
  });
};
