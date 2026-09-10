import {
  getApiBasePath,
  isPackagedElectronRenderer,
} from "../utils/environment";
import { getCsrfToken, getHumanApiToken } from "../utils/authStorage";

export type PlanningCenterStatus = {
  oauthConfigured: boolean;
  connected: boolean;
  accountLabel: string;
};

export type PlanningCenterConnectResponse = {
  authorizeUrl: string;
  connectRequestId: string;
  connectRequestSecret: string;
  expiresAt: number;
  pollIntervalMs: number;
};

export type PlanningCenterConnectStatus = {
  status: "pending" | "completed" | "failed" | "expired";
  errorMessage: string;
  accountLabel?: string;
};

type JsonInit = Omit<RequestInit, "body"> & {
  body?: Record<string, unknown>;
  timeoutMs?: number;
};

const fetchJson = async <T>(path: string, init: JsonInit = {}): Promise<T> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? 20000,
  );
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const csrf = getCsrfToken();
  if (csrf) headers.set("x-csrf-token", csrf);
  const humanToken = getHumanApiToken();
  if (isPackagedElectronRenderer() && humanToken) {
    headers.set("Authorization", `Bearer ${humanToken}`);
  }
  try {
    const response = await fetch(
      `${getApiBasePath()}${path.replace(/^\//, "")}`,
      {
        ...init,
        headers,
        body: init.body ? JSON.stringify(init.body) : undefined,
        credentials: "include",
        signal: controller.signal,
      },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok) {
      throw new Error(
        payload.error ||
          "Planning Center could not complete that request. Try again.",
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Planning Center took too long to respond. Try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
};

const base = (churchId: string) =>
  `api/churches/${encodeURIComponent(churchId)}/planning-center`;

export const getPlanningCenterStatus = (churchId: string) =>
  fetchJson<PlanningCenterStatus>(`${base(churchId)}/status`);

export const startPlanningCenterConnect = (
  churchId: string,
  options: { returnTo?: string; desktop?: boolean } = {},
) =>
  fetchJson<PlanningCenterConnectResponse>(`${base(churchId)}/connect-url`, {
    method: "POST",
    body: options,
  });

export const getPlanningCenterConnectStatus = (
  churchId: string,
  request: { connectRequestId: string; connectRequestSecret: string },
) =>
  fetchJson<PlanningCenterConnectStatus>(`${base(churchId)}/connect-status`, {
    method: "POST",
    body: request,
  });

export const disconnectPlanningCenter = (churchId: string) =>
  fetchJson<{ success: true }>(`${base(churchId)}/disconnect`, {
    method: "POST",
    body: {},
  });

export type PlanningCenterServiceType = {
  id: string;
  name: string;
};

export type PlanningCenterPlanSummary = {
  id: string;
  serviceTypeId: string;
  dates: string;
  title: string;
  label: string;
  itemsCount: number;
  sortDate: string;
  sourceUrl: string;
};

export type PlanningCenterPlanImport = {
  planLabel: string;
  sourceUrl: string;
  serviceTypeId: string;
  planId: string;
  sections: Array<{
    sectionName: string;
    rows: Array<{
      elementType: string;
      title: string;
      ledBy: string;
      startTime?: string;
      durationMinutes?: number;
      note?: string;
      teamNotes?: Array<{ teamName: string; note: string }>;
      songTitle?: string;
    }>;
  }>;
  teamAssignments: Array<{
    teamName: string;
    role: string;
    name: string;
  }>;
};

export const listPlanningCenterServiceTypes = (churchId: string) =>
  fetchJson<{ items: PlanningCenterServiceType[] }>(
    `${base(churchId)}/service-types`,
  );

export const listPlanningCenterPlans = (
  churchId: string,
  serviceTypeId: string,
  filter: "future" | "past" | "no_dates" = "future",
) => {
  const params = new URLSearchParams();
  if (filter) params.set("filter", filter);
  return fetchJson<{ items: PlanningCenterPlanSummary[] }>(
    `${base(churchId)}/service-types/${encodeURIComponent(serviceTypeId)}/plans${
      params.size ? `?${params}` : ""
    }`,
  );
};

export const getPlanningCenterPlanImport = (
  churchId: string,
  serviceTypeId: string,
  planId: string,
) =>
  fetchJson<PlanningCenterPlanImport>(
    `${base(churchId)}/service-types/${encodeURIComponent(serviceTypeId)}/plans/${encodeURIComponent(planId)}/import`,
    { timeoutMs: 60000 },
  );
