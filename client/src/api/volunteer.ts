import type { MyScheduleOperations, PersonalScheduleAccess } from "../pages/myScheduleOperations";
import { clearVolunteerIngress, readVolunteerIngress } from "../public/volunteerIngress";

export type VolunteerSession = { csrfToken: string; churchId: string; memberId: string; expiresAt: number };
// Personal access failures must not invoke the human-session sign-in toast.
export class VolunteerApiError extends Error {
  constructor(message: string, readonly status: number, readonly details: { accessStatus?: string }) {
    super(message);
    this.name = "VolunteerApiError";
  }
}
export const volunteerRequest = async <T>(path: string, body?: unknown, csrfToken = "", signal?: AbortSignal): Promise<T> => {
  const response = await fetch(`/api/volunteer/${path}`, {
    method: body === undefined ? "GET" : "POST", credentials: "include", cache: "no-store",
    referrerPolicy: "no-referrer", signal,
    headers: { "Content-Type": "application/json", "x-volunteer-csrf": csrfToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new VolunteerApiError(result.errorMessage || "Open your personal link to continue.",
    response.status, { accessStatus: result.accessStatus });
  return result as T;
};

let redemption: { token: string; promise: Promise<unknown> } | undefined;

const isAuthoritativeCredentialFailure = (error: unknown) =>
  error instanceof VolunteerApiError &&
  (error.details.accessStatus === "invalid" || error.details.accessStatus === "revoked");

const redeemIngressToken = (token: string) => {
  let promise!: Promise<unknown>;
  promise = volunteerRequest("redeem", { token }).then((result) => {
    // A different link may have arrived while this request was in flight.
    // Never clear that newer credential when the older redemption settles.
    if (readVolunteerIngress() === token) clearVolunteerIngress();
    return result;
  }).catch((error: unknown) => {
    // Network errors, throttling, server failures, origin/prefetch rejection,
    // and expired links are not proof that the bearer should be discarded.
    if (readVolunteerIngress() === token && isAuthoritativeCredentialFailure(error)) {
      clearVolunteerIngress();
    }
    throw error;
  }).finally(() => {
    if (redemption?.promise === promise) redemption = undefined;
  });
  redemption = { token, promise };
  return redemption;
};

export const openVolunteerSession = async (): Promise<VolunteerSession> => {
  while (true) {
    const token = readVolunteerIngress();
    const activeRedemption = redemption;

    // Serialize different links because redemption writes the same browser
    // cookie. The later link owns the next session read, even if the earlier
    // response settles after the link changed.
    if (activeRedemption && token && activeRedemption.token !== token) {
      try {
        await activeRedemption.promise;
      } catch {
        // The old token's failure must not prevent retrying the current link.
      }
      if (readVolunteerIngress() !== token) continue;
      continue;
    }

    if (token) {
      const flight = redemption?.token === token
        ? redemption
        : redeemIngressToken(token);
      try {
        await flight.promise;
      } catch (error) {
        const currentToken = readVolunteerIngress();
        if (currentToken && currentToken !== token) continue;
        throw error;
      }
      if (readVolunteerIngress() && readVolunteerIngress() !== token) continue;
    } else if (redemption) {
      try {
        await redemption.promise;
      } catch (error) {
        if (readVolunteerIngress()) continue;
        throw error;
      }
      if (readVolunteerIngress()) continue;
    }

    const tokenBeforeSession = readVolunteerIngress();
    try {
      const session = await volunteerRequest<VolunteerSession>("session");
      const currentToken = readVolunteerIngress();
      if (currentToken && currentToken !== tokenBeforeSession) continue;
      return session;
    } catch (error) {
      const currentToken = readVolunteerIngress();
      if (currentToken && currentToken !== tokenBeforeSession) continue;
      throw error;
    }
  }
};

export const personalScheduleAccess = (session: VolunteerSession): PersonalScheduleAccess => {
  const request = <T>(path: string, body?: unknown) => volunteerRequest<T>(path, body, session.csrfToken);
  const operations: MyScheduleOperations = {
    load: () => request("schedule"), respond: (body) => request<{ success: boolean; response: "accepted" | "declined" }>("respond", body),
    saveBlockouts: (blockoutDates, expectedUpdatedAt) => request("blockouts", { blockoutDates, expectedUpdatedAt }),
    acceptUnanswered: (afterScheduleId) => request("accept-unanswered", afterScheduleId ? { afterScheduleId } : {}),
  };
  return { churchId: session.churchId, memberId: session.memberId, operations };
};

export const volunteerRequestKey = () => Array.from(crypto.getRandomValues(new Uint8Array(24)))
  .map((value) => value.toString(16).padStart(2, "0")).join("");
