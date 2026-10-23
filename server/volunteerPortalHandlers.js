import crypto from "node:crypto";
import { isLinkPreviewCrawler } from "./publicShareMeta.js";

export const VOLUNTEER_SESSION_COOKIE = "__Host-worshipsync-volunteer";
const cookieValue = (req) => {
  const values = String(req.headers?.cookie || "").split(";")
    .map((value) => value.trim()).filter((value) => value.startsWith(`${VOLUNTEER_SESSION_COOKIE}=`));
  return values.length === 1 ? values[0].slice(VOLUNTEER_SESSION_COOKIE.length + 1) : "";
};
const equal = (first, second) => {
  const a = Buffer.from(String(first || ""));
  const b = Buffer.from(String(second || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Personal access is standard functionality. This adapter owns
// authentication/transport only, never schedule rules.
export const createVolunteerPortalHandlers = ({
  getAccessStore, getRecoveryStore, appBaseUrl, httpError, requireAdminSession, assertCsrf,
  enforceRateLimit, getClientIp, addSecurityEvent, logAuthEvent,
  getSchedule, respond, acceptUnanswered, saveBlockouts, getAvailability, submitAvailability,
}) => {
  const origin = new URL(appBaseUrl).origin;
  const assertOrigin = (req) => {
    if (req.headers?.origin !== origin) throw httpError(403, "Open My Schedule and try again.");
  };
  const storeForRequest = () => getAccessStore();
  const handle = (operation) => async (req, res) => {
    res.set({ "Cache-Control": "no-store", Pragma: "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow, noarchive" });
    try {
      await enforceRateLimit({ scope: "volunteer-http", key: getClientIp(req),
        limit: 120, windowMs: 60 * 1000, blockMs: 60 * 1000 });
      return await operation(req, res);
    } catch (error) {
      const status = error?.status || error?.statusCode || 500;
      return res.status(status).json({ success: false,
        errorMessage: status >= 500 ? "Could not open My Schedule. Try again in a moment." : error.message,
      });
    }
  };
  const setSessionCookie = (res, session, expiresAt) => res.cookie(VOLUNTEER_SESSION_COOKIE, session, {
    httpOnly: true, secure: true, sameSite: "strict", path: "/", expires: new Date(expiresAt),
  });
  const sessionIdentity = async (req, write = false) => {
    const store = storeForRequest();
    const cookie = cookieValue(req);
    const session = await store.readSession(cookie);
    if (!session) throw httpError(401, "Open your personal link to continue.");
    if (!equal(session.csrfToken, req.headers?.["x-volunteer-csrf"])) {
      throw httpError(403, "Open My Schedule and try again.");
    }
    if (write) {
      assertOrigin(req);
    }
    return {
      churchId: session.churchId, memberId: session.memberId,
      accessType: session.accessType, generation: session.generation, credentialDigest: session.credentialDigest,
      expiresAt: session.expiresAt, access: "personal", actorId: `volunteer:${session.memberId}`,
      // Read the credential generation in the same transaction as each write.
      authorize: async (transaction) => {
        const current = await store.readSession(cookie, transaction);
        if (!current || current.churchId !== session.churchId || current.memberId !== session.memberId) {
          throw httpError(401, "Open your personal link to continue.");
        }
      },
    };
  };
  const adminAction = (action) => handle(async (req, res) => {
    const store = storeForRequest();
    await assertCsrf(req);
    const admin = await requireAdminSession(req, req.params.churchId);
    const identity = { churchId: req.params.churchId, memberId: req.params.memberId };
    const actorUid = admin.user.uid;
    let result;
    if (action === "prepare" || action === "replace") {
      const prepared = await store.prepare(identity, { replace: action === "replace", actorUid, requestKey: req.body?.requestKey });
      result = { url: `${appBaseUrl}/s#${prepared.token}`, expiresAt: prepared.expiresAt };
    } else {
      await store[action](identity, actorUid);
      result = {};
    }
    await addSecurityEvent({ type: `volunteer_personal_access_${action}`, ...identity, userId: actorUid })
      .catch(() => logAuthEvent("warn", "volunteer.access.audit-failed", { ...identity, action }));
    return res.json({ success: true, ...result });
  });
  return {
    getVolunteerPersonalAccessStatus: handle(async (req, res) => {
      await requireAdminSession(req, req.params.churchId);
      const store = getAccessStore();
      const identity = { churchId: req.params.churchId, memberId: req.params.memberId };
      const state = await store.readState(identity);
      const active = await store.current(identity);
      return res.json({ success: true,
        status: state?.revokedAt ? "revoked" : active ? "active" : state?.credentialDigest ? "expired" : "none",
        ...(active ? { expiresAt: active.expiresAt } : {}),
      });
    }),
    startVolunteerContactVerification: handle(async (req, res) => {
      storeForRequest();
      await assertCsrf(req);
      const admin = await requireAdminSession(req, req.params.churchId);
      return res.json(await getRecoveryStore().start({
        requestKey: req.body?.requestKey, clientIp: getClientIp(req),
        enrollment: { identity: { churchId: req.params.churchId, memberId: req.params.memberId },
          channel: req.body?.channel, actorUid: admin.user.uid },
      }));
    }),
    verifyVolunteerContact: handle(async (req, res) => {
      storeForRequest();
      await assertCsrf(req);
      const admin = await requireAdminSession(req, req.params.churchId);
      const result = await getRecoveryStore().verify({
        challengeId: req.body?.challengeId, code: req.body?.code,
        completionKey: req.body?.completionKey, enrollmentActorUid: admin.user.uid,
        enrollmentIdentity: { churchId: req.params.churchId, memberId: req.params.memberId },
      });
      return res.status(result.success ? 200 : 400).json({ success: result.success });
    }),
    startVolunteerRecovery: handle(async (req, res) => {
      storeForRequest();
      assertOrigin(req);
      await enforceRateLimit({ scope: "volunteer-recovery-http", key: getClientIp(req),
        limit: 30, windowMs: 10 * 60 * 1000, blockMs: 10 * 60 * 1000 });
      return res.json(await getRecoveryStore().start({ token: req.body?.token, contact: req.body?.contact,
        requestKey: req.body?.requestKey, clientIp: getClientIp(req) }));
    }),
    verifyVolunteerRecovery: handle(async (req, res) => {
      storeForRequest();
      assertOrigin(req);
      await enforceRateLimit({ scope: "volunteer-recovery-verify-http", key: getClientIp(req),
        limit: 60, windowMs: 10 * 60 * 1000, blockMs: 10 * 60 * 1000 });
      const result = await getRecoveryStore().verify({ challengeId: req.body?.challengeId,
        code: req.body?.code, completionKey: req.body?.completionKey });
      if (!result.success) return res.status(400).json({ success: false, errorMessage: "Could not verify this code. Try again or request a new code." });
      setSessionCookie(res, result.session, result.expiresAt);
      return res.json({ success: true });
    }),
    prepareVolunteerPersonalAccess: adminAction("prepare"),
    replaceVolunteerPersonalAccess: adminAction("replace"),
    revokeVolunteerPersonalAccess: adminAction("revoke"),
    restoreVolunteerPersonalAccess: adminAction("restore"),
    redeemVolunteerPersonalAccess: handle(async (req, res) => {
      const store = storeForRequest();
      assertOrigin(req);
      await enforceRateLimit({ scope: "volunteer-link-redemption", key: getClientIp(req),
        limit: 30, windowMs: 10 * 60 * 1000, blockMs: 10 * 60 * 1000 });
      if (isLinkPreviewCrawler(req.headers?.["user-agent"] || "") ||
          /prefetch|preview/i.test(`${req.headers?.purpose || ""} ${req.headers?.["sec-purpose"] || ""}`)) {
        throw httpError(403, "Open your personal link in a browser to continue.");
      }
      const result = await store.redeem(String(req.body?.token || ""));
      if (result.status !== "active") {
        const status = { expired: 410, revoked: 403, invalid: 404 }[result.status] || 404;
        return res.status(status).json({ success: false, accessStatus: result.status });
      }
      setSessionCookie(res, result.session, result.expiresAt);
      return res.json({ success: true });
    }),
    getVolunteerPersonalSession: handle(async (req, res) => {
      const store = storeForRequest();
      const session = await store.readSession(cookieValue(req));
      if (!session) {
        return res.status(401).json({ success: false, accessStatus: "invalid",
          errorMessage: "Open your personal link to continue." });
      }
      return res.json({ success: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt,
        churchId: session.churchId, memberId: session.memberId });
    }),
    getVolunteerPersonalSchedule: handle(async (req, res) => res.json(await getSchedule(await sessionIdentity(req)))),
    respondToVolunteerPersonalAssignment: handle(async (req, res) => res.json(await respond(await sessionIdentity(req, true), req.body))),
    acceptVolunteerPersonalUnanswered: handle(async (req, res) => res.json(await acceptUnanswered(await sessionIdentity(req, true), req.body))),
    saveVolunteerPersonalBlockouts: handle(async (req, res) => res.json(await saveBlockouts(await sessionIdentity(req, true), req.body))),
    getVolunteerPersonalAvailability: handle(async (req, res) => res.json(await getAvailability(await sessionIdentity(req)))),
    submitVolunteerPersonalAvailability: handle(async (req, res) => res.json(await submitAvailability(await sessionIdentity(req, true), req.body))),
  };
};
