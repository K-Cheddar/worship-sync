import type { SessionKind } from "../api/authTypes";

export type AuditSnapshot = {
  userId: string;
  sessionKind: SessionKind;
  operatorName: string;
  deviceLabel: string;
  userEmail: string;
  displayName: string;
};

let snapshot: AuditSnapshot = {
  userId: "",
  sessionKind: null,
  operatorName: "",
  deviceLabel: "",
  userEmail: "",
  displayName: "",
};

export function setAuditSnapshot(next: Partial<AuditSnapshot>): void {
  snapshot = { ...snapshot, ...next };
}

export function getAuditActor(): string {
  const s = snapshot;
  if (s.sessionKind === "workstation") {
    const parts = [s.deviceLabel.trim(), s.operatorName.trim()].filter(Boolean);
    if (parts.length) {
      return parts.join(" | ");
    }
  }
  const display = s.displayName.trim();
  if (display) return display;
  const email = s.userEmail.trim();
  if (email) return email;
  const uid = s.userId.trim();
  if (uid) return uid;
  const label = s.deviceLabel.trim() || s.operatorName.trim();
  if (label) return label;
  return "unknown";
}

type AuditFields = {
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Stamps audit fields on a doc about to be written to Pouch.
 * On update, preserves existing `createdBy` from `existing` when present.
 *
 * `isNew` means first persistence (no prior row), e.g. `createNewItemInDb` with
 * `existing === null`. After a successful `db.get`, pass `isNew: false` even when
 * legacy docs omit `createdAt`.
 */
export function applyPouchAudit<T extends AuditFields>(
  existing: T | null | undefined,
  next: T,
  opts: { isNew: boolean },
): T {
  const actor = getAuditActor();
  if (opts.isNew) {
    return {
      ...next,
      createdBy: next.createdBy ?? actor,
      updatedBy: actor,
    };
  }
  return {
    ...next,
    createdBy: existing?.createdBy ?? next.createdBy,
    updatedBy: actor,
  };
}
