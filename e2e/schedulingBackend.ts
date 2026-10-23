import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Firestore } from "firebase-admin/firestore";
import type { Database } from "firebase-admin/database";
import { getFirebaseAdminRuntime } from "../server/firebaseAdminRuntime.js";
import { assertOwnedRecord, assertSafeSchedule, assertSchedulingRecoveryManifest, SCHEDULING_OWNER, type SchedulingScope } from "./schedulingScope";
import { getE2EChurchId } from "./testChurch";

const collections = ["teams", "teamPositions", "teamRosterMembers", "teamSchedules", "teamScheduleOccurrenceOwners"];
export const TEST_TEAM_NAME = "WorshipSync E2E Scheduling";
// Scheduling displays a unique first name without the surname.
export const TEST_MEMBER_NAME = "Scheduling E2E";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fingerprint = (value: any): string => {
  const ordered = (item: any): any => Array.isArray(item) ? item.map(ordered) : item && typeof item === "object"
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])])) : item;
  return hash(JSON.stringify(ordered(value)));
};
const normalizeServices = (value: any): any[] => Array.isArray(value) ? value.filter(Boolean) : Object.values(value || {}).filter(Boolean);

/** Backend setup/inspection only. Schedule creation, edits, ensure and deletion use the application API. */
export class SchedulingBackend {
  readonly scope: SchedulingScope;
  readonly runtime: { db: Firestore; rtdb: Database };
  readonly manifestPath: string;
  readonly startedAt = new Date().toISOString();
  readonly events: any[] = [];
  baselineHash = "";
  private journalQueue: Promise<void> = Promise.resolve();
  leaseAcquired = false;
  scheduleIntended = false;
  readonly userId: string;

  constructor(userId: string, recovery?: any) {
    const churchId = getE2EChurchId();
    const fixtureId = `e2e-scheduling-${hash(churchId).slice(0, 16)}`;
    const teamId = process.env.E2E_SCHEDULING_TEAM_ID?.trim() || fixtureId;
    this.scope = {
      churchId, teamId, fixtureId, runId: randomUUID(),
      positionId: `${fixtureId}-position`, memberId: `${fixtureId}-member`,
      serviceIds: [`${fixtureId}-service-a`, `${fixtureId}-service-b`],
      startDate: "2040-01-01", endDate: "2040-01-31",
      scheduleId: `generated_${hash(`${churchId}\u0000${teamId}\u00002040-01-01\u00002040-01-31`)}`,
    };
    if (recovery) {
      assertSchedulingRecoveryManifest(recovery, userId, this.scope);
      this.scope.runId = recovery.scope.runId;
      this.startedAt = recovery.startedAt;
      this.baselineHash = recovery.baselineHash;
      this.scheduleIntended = recovery.scheduleIntended === true;
      this.events.push(...recovery.events);
    }
    const runtime = getFirebaseAdminRuntime();
    if (!runtime?.db || !runtime.rtdb) throw new Error("Existing Firebase Admin and Realtime Database configuration is required for authoritative fixture verification.");
    this.runtime = runtime;
    this.userId = userId;
    this.manifestPath = resolve("playwright/.fixtures", `scheduling-${this.scope.runId}.json`);
  }

  marker(runOwned = false) {
    return { owner: SCHEDULING_OWNER, fixtureId: this.scope.fixtureId, ...(runOwned ? { runId: this.scope.runId } : {}) };
  }
  async journal(status: string, details?: any) {
    const write = async () => {
      this.events.push({ at: new Date().toISOString(), status, ...details });
      await mkdir(resolve("playwright/.fixtures"), { recursive: true });
      await writeFile(`${this.manifestPath}.tmp`, JSON.stringify({ owner: SCHEDULING_OWNER, scope: this.scope, startedAt: this.startedAt, userId: this.userId, baselineHash: this.baselineHash, status, scheduleIntended: this.scheduleIntended, events: this.events }, null, 2));
      await rename(`${this.manifestPath}.tmp`, this.manifestPath);
    };
    this.journalQueue = this.journalQueue.then(write, write);
    return this.journalQueue;
  }
  async schedules(): Promise<any[]> {
    const result = await this.runtime.db.collection("teamSchedules").where("churchId", "==", this.scope.churchId).get();
    return result.docs.map(doc => ({ ...doc.data(), scheduleId: doc.id } as Record<string, any>)).filter(doc => doc.teamId === this.scope.teamId);
  }
  async claims(): Promise<any[]> {
    const result = await this.runtime.db.collection("teamScheduleOccurrenceOwners").where("churchId", "==", this.scope.churchId).get();
    return result.docs.map(doc => ({ ...doc.data(), id: doc.id } as Record<string, any>)).filter(doc => doc.teamId === this.scope.teamId);
  }
  async schedule() {
    const snapshot = await this.runtime.db.collection("teamSchedules").doc(this.scope.scheduleId).get();
    return snapshot.exists ? { ...snapshot.data(), scheduleId: snapshot.id } : null;
  }
  async services() {
    return normalizeServices((await this.runtime.rtdb!.ref(`churches/${this.scope.churchId}/data/services`).once("value")).val());
  }
  async unrelatedSnapshot() {
    const result: Record<string, any> = {};
    for (const collection of collections) {
      const snapshot = await this.runtime.db.collection(collection).where("churchId", "==", this.scope.churchId).get();
      result[collection] = snapshot.docs.filter(doc => doc.id !== this.scope.teamId && doc.data().teamId !== this.scope.teamId && doc.id !== this.scope.memberId)
        .map(doc => [doc.id, doc.data()]).sort(([a], [b]) => String(a).localeCompare(String(b)));
    }
    result.services = (await this.services()).filter(service => !this.scope.serviceIds.includes(service.id)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return result;
  }
  async begin() {
    await mkdir(resolve("playwright/.fixtures"), { recursive: true });
    for (const file of await readdir(resolve("playwright/.fixtures"))) {
      if (!/^scheduling-[0-9a-f-]+\.json$/.test(file)) continue;
      const previous = JSON.parse(await readFile(resolve("playwright/.fixtures", file), "utf8"));
      if (previous.scope?.churchId === this.scope.churchId && previous.scope?.teamId === this.scope.teamId && previous.status !== "cleaned") {
        throw new Error(`Interrupted fixture preserved: ${file}; schedule ${previous.scope.scheduleId}; run ${previous.scope.runId}. Review the exact manifest before recovery.`);
      }
    }
    if ((await this.schedules()).length || (await this.claims()).length) throw new Error(`Reserved team ${this.scope.teamId} has existing schedules/claims; preserved all IDs. Inspect before running.`);
    const namedTeams = await this.runtime.db.collection("teams").where("churchId", "==", this.scope.churchId).get();
    const ambiguous = namedTeams.docs.filter(doc => doc.id !== this.scope.teamId && doc.data().name === TEST_TEAM_NAME);
    if (ambiguous.length) throw new Error(`Reserved team name is already used by other IDs: ${ambiguous.map(doc => doc.id)}; preserved them`);
    const services = await this.services();
    if (services.some(service => this.scope.serviceIds.includes(service.id))) throw new Error(`Reserved service IDs already exist: ${this.scope.serviceIds.join(", ")}; preserved them.`);
    // A service belongs only to the test position and is never combined. Check
    // that unrelated service definitions cannot pull that position into a group.
    if (services.some(service => service.positionRequirements?.some((requirement: any) => requirement.positionId === this.scope.positionId))) {
      throw new Error(`Position ${this.scope.positionId} is referenced by an unrelated service; preserved it.`);
    }
    this.baselineHash = fingerprint(await this.unrelatedSnapshot());
    await this.journal("planned");
    const { churchId, teamId, memberId, positionId } = this.scope;
    const stable = [
      { collection: "teams", id: teamId, data: { teamId, churchId, name: TEST_TEAM_NAME, memberIds: [memberId], usesMicrophoneAssignments: false, usesIemAssignments: false, archivedAt: null, e2eFixture: this.marker() } },
      { collection: "teamPositions", id: positionId, data: { positionId, teamId, churchId, name: "E2E Position", order: 0, archivedAt: null, e2eFixture: this.marker() } },
      { collection: "teamRosterMembers", id: memberId, data: { memberId, teamId, churchId, firstName: "Scheduling E2E", lastName: "Volunteer", teamIds: [teamId], positionIds: [positionId], blockoutDates: [], archivedAt: null, e2eFixture: this.marker() } },
    ];
    await this.runtime.db.runTransaction(async transaction => {
      const refs = stable.map(item => this.runtime.db.collection(item.collection).doc(item.id));
      const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
      snapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) return;
        const data = snapshot.data()!;
        assertOwnedRecord(data, this.scope, snapshot.id);
        if (data.archivedAt || (index === 0 && (data.name !== TEST_TEAM_NAME || data.e2eFixture.activeRunId || !isDeepStrictEqual(data.memberIds, [memberId]))) ||
            (index === 2 && (data.email || data.phoneNumber || data.userId || !isDeepStrictEqual(data.teamIds, [teamId]) || !isDeepStrictEqual(data.positionIds, [positionId])))) {
          throw new Error(`Preserved changed/active fixture ${snapshot.id}; manual review required`);
        }
      });
      snapshots.forEach((snapshot, index) => { if (!snapshot.exists) transaction.create(refs[index], stable[index].data); });
      transaction.set(refs[0], { e2eFixture: { ...this.marker(), activeRunId: this.scope.runId } }, { merge: true });
    });
    this.leaseAcquired = true;
    await this.journal("active", { stableIds: stable.map(item => item.id) });
    await this.addService(0);
  }
  async addService(index: number) {
    const id = this.scope.serviceIds[index];
    await this.journal("service-write-intended", { id });
    const definition = { id, serviceId: id, churchId: this.scope.churchId, teamId: this.scope.teamId,
      name: `E2E Scheduling ${index === 0 ? "First" : "Added"}`, reccurence: "one_time", dateTimeISO: `2040-01-${index === 0 ? "08" : "15"}T17:00:00.000Z`,
      positionRequirements: [{ positionId: this.scope.positionId, count: 1 }], e2eFixture: this.marker(true) };
    const ref = this.runtime.rtdb!.ref(`churches/${this.scope.churchId}/data/services`);
    const result = await ref.transaction(current => {
      const services = normalizeServices(current);
      if (services.some(service => service.id === id)) return undefined;
      return [...services, definition];
    }, undefined, false);
    if (!result.committed) throw new Error(`Service ID ${id} already exists; preserved it`);
    if (!isDeepStrictEqual((await this.services()).find(service => service.id === id), definition)) throw new Error(`Service ${id} did not persist`);
    await this.journal("service-created", { id });
  }
  async intendSchedule() {
    this.scheduleIntended = true;
    await this.journal("schedule-write-intended", { id: this.scope.scheduleId });
  }
  async adoptSchedule() {
    await this.runtime.db.runTransaction(async transaction => {
      const ref = this.runtime.db.collection("teamSchedules").doc(this.scope.scheduleId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const data = snapshot.data()!;
      if (data.e2eFixture) { assertSafeSchedule({ ...data, scheduleId: ref.id }, this.scope); return; }
      // The manifest records the exact canonical ID before the request. Lost
      // responses are recoverable only when creator, time, scope and contents agree.
      if (!this.scheduleIntended || data.createdByUid !== this.userId || typeof data.createdAt !== "string" ||
          !Number.isFinite(Date.parse(data.createdAt)) || data.createdAt < this.startedAt ||
          data.source !== "generated-period" || data.generatedPeriodKey !== this.scope.scheduleId.slice("generated_".length) ||
          data.startDate !== this.scope.startDate || data.endDate !== this.scope.endDate) throw new Error(`Preserved ${ref.id}: creation ownership is ambiguous`);
      const owned = { ...data, scheduleId: ref.id, e2eFixture: this.marker(true) };
      assertSafeSchedule(owned, this.scope);
      transaction.update(ref, { e2eFixture: this.marker(true) });
    });
    await this.journal("schedule-owned", { id: this.scope.scheduleId, claimIds: (await this.claims()).map(claim => claim.id) });
  }
  async verifyReleased(recordEvent = true) {
    if (await this.schedule()) throw new Error(`Schedule remains: ${this.scope.scheduleId}`);
    const claims = await this.claims();
    if (claims.length) throw new Error(`Occurrence claims remain: ${claims.map(claim => claim.id).join(", ")}`);
    if ((await this.schedules()).length) throw new Error(`Duplicate schedules remain in ${this.scope.teamId}`);
    if (recordEvent) await this.journal("schedule-cleaned", { id: this.scope.scheduleId, claims: [] });
  }
  async cleanup(deleteSchedule: () => Promise<void>) {
    if (!this.leaseAcquired) return;
    try {
      if (await this.schedule()) {
        await this.adoptSchedule();
        assertSafeSchedule(await this.schedule(), this.scope);
        await deleteSchedule();
      }
      await this.verifyReleased();
      const allSchedules = await this.runtime.db.collection("teamSchedules").where("churchId", "==", this.scope.churchId).get();
      const adopted = allSchedules.docs.filter(doc => (doc.data().serviceIds || []).some((id: string) => this.scope.serviceIds.includes(id)) ||
        (doc.data().occurrences || []).some((row: any) => (row.serviceIds || [row.serviceId]).some((id: string) => this.scope.serviceIds.includes(id))));
      if (adopted.length) throw new Error(`Preserved services ${this.scope.serviceIds}: referenced by schedules ${adopted.map(doc => doc.id)}`);
      const servicesRef = this.runtime.rtdb!.ref(`churches/${this.scope.churchId}/data/services`);
      const result = await servicesRef.transaction(current => {
        const services = normalizeServices(current);
        for (const service of services.filter(service => this.scope.serviceIds.includes(service.id))) assertOwnedRecord(service, this.scope, service.id, true);
        return services.filter(service => !this.scope.serviceIds.includes(service.id));
      }, undefined, false);
      if (!result.committed || (await this.services()).some(service => this.scope.serviceIds.includes(service.id))) throw new Error(`Service cleanup failed: ${this.scope.serviceIds}`);
      if (fingerprint(await this.unrelatedSnapshot()) !== this.baselineHash) throw new Error("Unrelated demo records changed during this run; inspect backend before another run");
      await this.runtime.db.runTransaction(async transaction => {
        const ref = this.runtime.db.collection("teams").doc(this.scope.teamId);
        const snapshot = await transaction.get(ref);
        assertOwnedRecord(snapshot.data(), this.scope, ref.id);
        if (snapshot.data()?.e2eFixture.activeRunId !== this.scope.runId) throw new Error(`Test team lease changed: ${ref.id}`);
        transaction.update(ref, { e2eFixture: this.marker() });
      });
      await this.journal("cleaned", { durationMs: Date.now() - Date.parse(this.startedAt), scheduleId: this.scope.scheduleId, serviceIds: this.scope.serviceIds, unrelatedRecordsUnchanged: true });
      this.leaseAcquired = false;
    } catch (error) {
      await this.journal("cleanup-failed", { reason: String(error), preservedIds: [this.scope.scheduleId, ...this.scope.serviceIds] });
      throw error;
    }
  }

  async verifyRecoveryLease() {
    const snapshot = await this.runtime.db.collection("teams").doc(this.scope.teamId).get();
    assertOwnedRecord(snapshot.data(), this.scope, this.scope.teamId);
    if (!snapshot.data()?.e2eFixture.activeRunId) {
      // Cleanup may have committed before its final local journal write.
      await this.verifyReleased(false);
      if ((await this.services()).some(service => this.scope.serviceIds.includes(service.id)) ||
          fingerprint(await this.unrelatedSnapshot()) !== this.baselineHash) throw new Error(`Preserved interrupted fixture ${this.scope.runId}: released lease but cleanup cannot be verified`);
      await this.journal("cleaned", { recoveredCompletedCleanup: true });
      return false;
    }
    if (snapshot.data()?.e2eFixture.activeRunId !== this.scope.runId) throw new Error(`Preserved ${this.scope.teamId}: interrupted run does not own its fixture lease`);
    this.leaseAcquired = true;
    return true;
  }
}
