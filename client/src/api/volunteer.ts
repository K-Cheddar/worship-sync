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

let redemption: Promise<unknown> | undefined;
export const openVolunteerSession = async () => {
  const token = readVolunteerIngress();
  if (token) {
    if (!redemption) redemption = volunteerRequest("redeem", { token }).then((result) => {
      clearVolunteerIngress(); return result;
    }).catch((error: unknown) => {
      redemption = undefined;
      if (error instanceof VolunteerApiError && error.status !== 410) clearVolunteerIngress();
      throw error;
    });
    await redemption;
  }
  return volunteerRequest<VolunteerSession>("session");
};

export const personalScheduleAccess = (session: VolunteerSession): PersonalScheduleAccess => {
  const request = <T>(path: string, body?: unknown) => volunteerRequest<T>(path, body, session.csrfToken);
  const operations: MyScheduleOperations = {
    load: () => request("schedule"), respond: (body) => request("respond", body),
    saveBlockouts: (blockoutDates, expectedUpdatedAt) => request("blockouts", { blockoutDates, expectedUpdatedAt }),
    acceptUnanswered: (afterScheduleId) => request("accept-unanswered", afterScheduleId ? { afterScheduleId } : {}), availability: () => request("availability"),
    submitAvailability: (recipientId, occurrenceAvailability) => request("availability", { recipientId, occurrenceAvailability }),
  };
  return { churchId: session.churchId, memberId: session.memberId, operations };
};

export const volunteerRequestKey = () => Array.from(crypto.getRandomValues(new Uint8Array(24)))
  .map((value) => value.toString(16).padStart(2, "0")).join("");
