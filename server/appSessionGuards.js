/**
 * App-session middleware used by boards admin, song-audio, and related mounts.
 * Extracted so authz branches can be unit-tested without booting server.js.
 */

export const createAppSessionGuards = ({
  resolveRequestBootstrap,
  assertRequestCsrf,
}) => {
  const requireAppSession = async (req, res, next) => {
    try {
      const bootstrap = await resolveRequestBootstrap(req);
      if (
        bootstrap?.authenticated &&
        bootstrap.sessionKind !== "display" &&
        bootstrap.database
      ) {
        req.appSession = {
          userId: bootstrap.user?.uid || "",
          actorId: bootstrap.user?.uid || bootstrap.device?.deviceId || "",
          username:
            bootstrap.user?.displayName ||
            bootstrap.device?.operatorName ||
            bootstrap.device?.label ||
            "Operator",
          sessionKind: bootstrap.sessionKind,
          database: bootstrap.database,
          access: bootstrap.appAccess || "view",
          churchId: bootstrap.churchId || "",
          role: bootstrap.role || "member",
        };
        return next();
      }

      return res.status(401).json({ error: "Sign in to continue." });
    } catch (error) {
      console.error("Board auth error:", error);
      return res.status(401).json({ error: "Sign in to continue." });
    }
  };

  const requireFullAppAccess = (req, res, next) => {
    if (req.appSession?.access !== "full") {
      return res.status(403).json({ error: "Full access is required." });
    }
    next();
  };

  const requireChurchAdmin = (req, res, next) => {
    if (req.appSession?.role !== "admin") {
      return res.status(403).json({
        error: "A church admin must manage this connection.",
      });
    }
    next();
  };

  const requireMutationCsrf = async (req, res, next) => {
    try {
      await assertRequestCsrf?.(req);
      next();
    } catch (error) {
      return res.status(error?.statusCode || 403).json({
        error: error?.message || "Could not verify this request.",
      });
    }
  };

  const requireSongAudioEditAccess = (req, res, next) => {
    if (
      req.appSession?.access !== "full" &&
      req.appSession?.access !== "music"
    ) {
      return res.status(403).json({ error: "Music access is required." });
    }
    next();
  };

  const assertSongAudioChurchAccess = (req, res) => {
    if (req.appSession?.churchId !== req.params.churchId) {
      res.status(403).json({ error: "That church is not available." });
      return false;
    }
    return true;
  };

  return {
    requireAppSession,
    requireMutationCsrf,
    requireFullAppAccess,
    requireChurchAdmin,
    requireSongAudioEditAccess,
    assertSongAudioChurchAccess,
  };
};
