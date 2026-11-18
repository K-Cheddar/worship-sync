import PouchDB from "pouchdb-browser";
import {
  DEMO_TENANT,
  MOBILE_TEST_DOCUMENT_PREFIX,
  assertSafeOutboundTestIds,
  createRemoteDatabase,
  establishCouchSession,
} from "./db/remote";
import type { RemoteConfig } from "./db/remote";
import { getDemoSession, signInToDemo, signOutOfDemo, verifyDemoEmailCode } from "./auth";
import "./styles.css";

const STORAGE_KEY = "worshipsync-mobile-poc-remote-config";
const DELETED_IDS_KEY = "worshipsync-mobile-poc-peer-deleted-test-ids";
const LOCAL_PEER_DB = "worshipsync-mobile-poc-desktop-peer-demo";
const runtime = document.querySelector<HTMLElement>("#runtime")!;
const output = document.querySelector<HTMLElement>("#output")!;
const message = document.querySelector<HTMLElement>("#message")!;
const apiInput = document.querySelector<HTMLInputElement>("#api-base")!;
const couchInput = document.querySelector<HTMLInputElement>("#couch-url")!;
const idInput = document.querySelector<HTMLInputElement>("#test-id")!;
const authorize = document.querySelector<HTMLInputElement>("#authorize")!;
const authStatus = document.querySelector<HTMLElement>("#auth-status")!;
const authEmail = document.querySelector<HTMLInputElement>("#auth-email")!;
const authPassword = document.querySelector<HTMLInputElement>("#auth-password")!;
const emailCodePanel = document.querySelector<HTMLElement>("#email-code-panel")!;
const emailCodeInput = document.querySelector<HTMLInputElement>("#email-code")!;
let pendingEmailCode: { id: string; email: string } | null = null;
let peerCsrfToken: string | null = null;

const savedConfig = (): RemoteConfig => {
  try {
    return { ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<RemoteConfig> } as RemoteConfig;
  } catch {
    return { apiBaseUrl: "", couchDbUrl: "" };
  }
};

const config = savedConfig();
apiInput.value = config.apiBaseUrl || "";
couchInput.value = config.couchDbUrl || "";

const database = new PouchDB(LOCAL_PEER_DB, { adapter: "idb" });
const databaseAdapter = database as PouchDB.Database & { adapter?: string };
const getId = () => assertSafeOutboundTestIds([idInput.value.trim()])[0];
const deletedIds = (): string[] => {
  try {
    const value = JSON.parse(localStorage.getItem(DELETED_IDS_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};
const rememberDeletedId = (id: string) => {
  localStorage.setItem(DELETED_IDS_KEY, JSON.stringify([...new Set([...deletedIds(), id])].slice(-200)));
};
const assertTestDoc = (document: { _id: string; type?: string; tenant?: string }, id: string) => {
  if (document._id !== id || document.type !== "worshipsync-mobile-poc-test" || document.tenant !== DEMO_TENANT) {
    throw new Error("This ID is not a demo-tenant mobile POC test document.");
  }
};
const remote = () => createRemoteDatabase("content", couchInput.value);
const report = (value: unknown) => { output.textContent = JSON.stringify(value, null, 2); };
const run = async (label: string, action: () => Promise<unknown>) => {
  message.textContent = `${label}…`;
  try {
    const result = await action();
    report(result);
    message.textContent = `${label} completed.`;
  } catch (error) {
    message.textContent = `${label} failed: ${error instanceof Error ? error.message : String(error)}`;
  }
};

const persistConfig = () => localStorage.setItem(STORAGE_KEY, JSON.stringify({
  apiBaseUrl: apiInput.value.trim(),
  couchDbUrl: couchInput.value.trim(),
}));

void getDemoSession(apiInput.value).then((session) => {
  peerCsrfToken = session?.csrfToken || null;
  authStatus.textContent = session ? `Signed in · ${session.user?.email || session.database}` : "Sign in to the demo tenant";
}).catch((error) => {
  authStatus.textContent = "Sign in to the demo tenant";
  message.textContent = error instanceof Error ? error.message : String(error);
});

document.querySelector("#sign-in")!.addEventListener("click", () => void run("Sign in to the demo tenant", async () => {
  persistConfig();
  const result = await signInToDemo(apiInput.value, authEmail.value, authPassword.value);
  authPassword.value = "";
  if (result.requiresEmailCode) {
    pendingEmailCode = { id: result.pendingAuthId, email: result.verificationEmail };
    emailCodePanel.hidden = false;
    authStatus.textContent = `Verification code sent to ${result.verificationEmail}`;
    return { requiresEmailCode: true, email: result.verificationEmail };
  }
  pendingEmailCode = null;
  emailCodePanel.hidden = true;
  peerCsrfToken = result.bootstrap.csrfToken || null;
  authStatus.textContent = `Signed in · ${result.bootstrap.user?.email || result.bootstrap.database}`;
  return { authenticated: result.bootstrap.authenticated, database: result.bootstrap.database };
}));

document.querySelector("#verify-code")!.addEventListener("click", () => void run("Verify demo account sign-in", async () => {
  if (!pendingEmailCode) throw new Error("Start a sign-in first.");
  const bootstrap = await verifyDemoEmailCode(apiInput.value, pendingEmailCode.id, emailCodeInput.value);
  pendingEmailCode = null;
  peerCsrfToken = bootstrap.csrfToken || null;
  emailCodeInput.value = "";
  emailCodePanel.hidden = true;
  authStatus.textContent = `Signed in · ${bootstrap.user?.email || bootstrap.database}`;
  return { authenticated: bootstrap.authenticated, database: bootstrap.database };
}));

document.querySelector("#sign-out")!.addEventListener("click", () => void run("Sign out of the demo tenant", async () => {
  await signOutOfDemo(apiInput.value, peerCsrfToken);
  peerCsrfToken = null;
  pendingEmailCode = null;
  emailCodePanel.hidden = true;
  authStatus.textContent = "Signed out";
}));

void database.info().then(() => {
  runtime.textContent = `Browser · ${databaseAdapter.adapter}`;
  runtime.className = `status-pill ${databaseAdapter.adapter === "idb" ? "good" : "bad"}`;
  if (databaseAdapter.adapter !== "idb") throw new Error(`Expected IndexedDB peer; PouchDB selected ${databaseAdapter.adapter}.`);
  report({ localDatabase: LOCAL_PEER_DB, adapter: databaseAdapter.adapter, remoteTenant: DEMO_TENANT });
}).catch((error) => {
  runtime.textContent = "Browser PouchDB unavailable";
  runtime.className = "status-pill bad";
  message.textContent = error instanceof Error ? error.message : String(error);
});

document.querySelector("#pull-one")!.addEventListener("click", () => void run("Pull selected test document", async () => {
  persistConfig();
  const id = getId();
  await establishCouchSession(apiInput.value);
  const result = await remote().replicate.to(database, { doc_ids: [id], retry: false });
  return { id, status: result.status, docsRead: result.docs_read, docsWritten: result.docs_written };
}));

document.querySelector("#edit-peer")!.addEventListener("click", () => void run("Edit selected document on desktop", async () => {
  const id = getId();
  if (deletedIds().includes(id)) throw new Error("This peer has a local deletion pending; push it before editing again.");
  let current: PouchDB.Core.ExistingDocument<{ mobileText?: string; desktopText?: string; editNumber?: number }> | undefined;
  try { current = await database.get(id); }
  catch (error) {
    if (!(error && typeof error === "object" && "status" in error && error.status === 404)) throw error;
  }
  if (current) assertTestDoc(current as typeof current & { _id: string; type?: string; tenant?: string }, id);
  const document = {
    ...(current ?? {}),
    _id: id,
    type: "worshipsync-mobile-poc-test",
    tenant: DEMO_TENANT,
    mobileText: current?.mobileText ?? "",
    desktopText: `Desktop edit ${new Date().toISOString()}`,
    editNumber: (current?.editNumber ?? 0) + 1,
  };
  const result = await database.put(document);
  return { id, revision: result.rev, mobileText: document.mobileText, desktopText: document.desktopText, editNumber: document.editNumber };
}));

document.querySelector("#inspect")!.addEventListener("click", () => void run("Inspect selected revision tree", async () => {
  const id = getId();
  const document = await database.get<PouchDB.Core.ExistingDocument<{ mobileText?: string; desktopText?: string }>>(id, { conflicts: true });
  assertTestDoc(document as typeof document & { type?: string; tenant?: string }, id);
  return {
    id,
    winningRevision: document._rev,
    conflicts: (document as typeof document & { _conflicts?: string[] })._conflicts ?? [],
    mobileText: document.mobileText ?? "",
    desktopText: document.desktopText ?? "",
  };
}));

document.querySelector("#delete-peer")!.addEventListener("click", () => void run("Delete selected document locally", async () => {
  const id = getId();
  const document = await database.get(id);
  assertTestDoc(document as PouchDB.Core.ExistingDocument<{ type?: string; tenant?: string }>, id);
  const result = await database.remove(document);
  rememberDeletedId(id);
  return { id, tombstoneRevision: result.rev, message: "Local tombstone created; it is not sent until the explicit Push button is used." };
}));

document.querySelector("#push-one")!.addEventListener("click", () => void run("Push exact selected document ID", async () => {
  if (!authorize.checked) throw new Error("Check the explicit remote-write authorization box first.");
  persistConfig();
  const id = getId();
  await establishCouchSession(apiInput.value);
  if (!deletedIds().includes(id)) {
    const document = await database.get<PouchDB.Core.ExistingDocument<{ mobileText?: string; desktopText?: string }>>(id);
    assertTestDoc(document as typeof document & { type?: string; tenant?: string }, id);
  }
  const result = await database.replicate.to(remote(), { doc_ids: assertSafeOutboundTestIds([id]), retry: false });
  return { id, status: result.status, docsRead: result.docs_read, docsWritten: result.docs_written };
}));

if (!idInput.value.trim()) idInput.value = new URLSearchParams(location.search).get("id") || "";
if (idInput.value && !idInput.value.startsWith(MOBILE_TEST_DOCUMENT_PREFIX)) {
  message.textContent = `Only IDs beginning with ${MOBILE_TEST_DOCUMENT_PREFIX} are accepted.`;
}
