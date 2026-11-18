import { getHumanAuth } from "@worshipsync/firebase/apps";
import {
  inMemoryPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { DEMO_TENANT, createApiEndpoint } from "./db/remote";

export type DemoAuthBootstrap = {
  authenticated: boolean;
  database?: string;
  churchName?: string;
  csrfToken?: string | null;
  user?: { email?: string; displayName?: string } | null;
};

type SessionResponse = {
  success?: boolean;
  message?: string;
  bootstrap?: DemoAuthBootstrap;
  requiresEmailCode?: boolean;
  pendingAuthId?: string;
  verificationEmail?: string;
};

export type SignInResult =
  | { requiresEmailCode: true; pendingAuthId: string; verificationEmail: string }
  | { requiresEmailCode: false; bootstrap: DemoAuthBootstrap };

const fetchJson = async <T,>(url: URL, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  let body: (T & { message?: string; errorMessage?: string; error?: string }) | undefined;
  try { body = await response.json() as typeof body; }
  catch { /* handled below */ }
  if (!response.ok) {
    const reason = body?.message || body?.errorMessage || body?.error;
    throw new Error(reason || `WorshipSync API returned HTTP ${response.status}.`);
  }
  if (!body) throw new Error("WorshipSync API returned an unreadable response.");
  return body;
};

const assertDemoBootstrap = (bootstrap?: DemoAuthBootstrap) => {
  if (!bootstrap?.authenticated) throw new Error("Sign in with an active WorshipSync account before connecting to CouchDB.");
  if (bootstrap.database !== DEMO_TENANT) {
    throw new Error(`This experiment only connects to the demo tenant. The signed-in account resolves to ${bootstrap.database || "no tenant"}.`);
  }
  return bootstrap;
};

const signOutServerSession = async (apiBaseUrl: string, csrfToken?: string | null) => {
  await fetchJson<{ success?: boolean }>(createApiEndpoint(apiBaseUrl, "api/auth/logout"), {
    method: "POST",
    body: JSON.stringify({}),
    headers: csrfToken ? { "x-csrf-token": csrfToken } : {},
  });
};

const acceptDemoBootstrap = async (apiBaseUrl: string, bootstrap?: DemoAuthBootstrap) => {
  try { return assertDemoBootstrap(bootstrap); }
  catch (error) {
    if (bootstrap?.authenticated) {
      try { await signOutServerSession(apiBaseUrl, bootstrap.csrfToken); }
      catch { /* the caller still receives the tenant mismatch */ }
      await firebaseSignOut(getHumanAuth()).catch(() => undefined);
    }
    throw error;
  }
};

const deviceId = () => {
  const key = "worshipsync_device_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
};

export const signInToDemo = async (apiBaseUrl: string, email: string, password: string): Promise<SignInResult> => {
  const auth = getHumanAuth();
  await setPersistence(auth, inMemoryPersistence);
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  const idToken = await credential.user.getIdToken(true);
  try {
    const response = await fetchJson<SessionResponse>(createApiEndpoint(apiBaseUrl, "api/auth/session"), {
      method: "POST",
      body: JSON.stringify({
        idToken,
        deviceId: deviceId(),
        userAgent: navigator.userAgent,
        platform: "capacitor-mobile-poc",
        deviceLabel: "WorshipSync mobile storage PoC",
        requestNewCode: true,
      }),
    });
    if (!response.success) throw new Error(response.message || "WorshipSync did not establish an app session.");
    if (response.requiresEmailCode && response.pendingAuthId) {
      return {
        requiresEmailCode: true,
        pendingAuthId: response.pendingAuthId,
        verificationEmail: response.verificationEmail || email.trim(),
      };
    }
    return { requiresEmailCode: false, bootstrap: await acceptDemoBootstrap(apiBaseUrl, response.bootstrap) };
  } catch (error) {
    await firebaseSignOut(auth).catch(() => undefined);
    throw error;
  }
};

export const verifyDemoEmailCode = async (
  apiBaseUrl: string,
  pendingAuthId: string,
  code: string,
): Promise<DemoAuthBootstrap> => {
  const response = await fetchJson<SessionResponse>(createApiEndpoint(apiBaseUrl, "api/auth/verify-email-code"), {
    method: "POST",
    body: JSON.stringify({
      pendingAuthId,
      code: code.trim(),
      deviceId: deviceId(),
      userAgent: navigator.userAgent,
      platform: "capacitor-mobile-poc",
      deviceLabel: "WorshipSync mobile storage PoC",
    }),
  });
  if (!response.success) throw new Error(response.message || "WorshipSync could not verify this sign-in code.");
  return acceptDemoBootstrap(apiBaseUrl, response.bootstrap);
};

export const getDemoSession = async (apiBaseUrl: string) => {
  const response = await fetchJson<DemoAuthBootstrap>(createApiEndpoint(apiBaseUrl, "api/auth/me"));
  if (!response.authenticated) return null;
  return assertDemoBootstrap(response);
};

export const signOutOfDemo = async (apiBaseUrl: string, csrfToken?: string | null) => {
  try { await signOutServerSession(apiBaseUrl, csrfToken); }
  finally { await firebaseSignOut(getHumanAuth()).catch(() => undefined); }
};
