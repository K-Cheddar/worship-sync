import { getApiBasePath } from "../utils/environment";
import type { PublicServiceFlowSnapshot } from "./serviceFlowTypes";

const getPublicServiceUrl = (shareId: string) =>
  `${getApiBasePath()}api/service-plan/public?token=${encodeURIComponent(shareId)}`;

/**
 * A load failure that means the link itself no longer grants access — the plan
 * was unpublished or deleted, or the token was revoked. Distinct from a
 * transient network/server error, because a revoked service must stop being
 * displayed rather than fall back to the last snapshot.
 */
export class PublicServiceAccessRevokedError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PublicServiceAccessRevokedError";
    this.status = status;
  }
}

const REVOKED_STATUSES = new Set([401, 403, 404, 410]);

export const getPublicServiceFlow = async (shareId: string): Promise<PublicServiceFlowSnapshot> => {
  const response = await fetch(getPublicServiceUrl(shareId));
  const body = await response.json().catch(() => null) as
    | { error?: string; errorMessage?: string }
    | PublicServiceFlowSnapshot
    | null;
  if (!response.ok || !body || !("service" in body)) {
    const error = body && "error" in body && typeof body.error === "string"
      ? body.error
      : "";
    const errorMessage = body && "errorMessage" in body && typeof body.errorMessage === "string"
      ? body.errorMessage
      : "";
    const message = error || errorMessage || "Could not load this service.";
    // A 2xx that somehow lacks a service body is malformed, not revoked, so
    // only real access failures get the revoked treatment.
    if (REVOKED_STATUSES.has(response.status)) {
      throw new PublicServiceAccessRevokedError(message, response.status);
    }
    throw new Error(message);
  }
  return body;
};

export const getPublicServiceFlowStreamUrl = (shareId: string) =>
  `${getApiBasePath()}api/service-plan/public/stream?token=${encodeURIComponent(shareId)}`;
