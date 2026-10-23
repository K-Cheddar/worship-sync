import { test, expect, applicationApi } from "./schedulingFixtures";
import { TEST_MEMBER_NAME } from "./schedulingBackend";

test("A — first edit creates one private Draft that survives reload and ensure", async ({ scheduling: fixture }) => {
  const { backend, page, scope } = fixture;
  expect(await backend.schedules()).toEqual([]);
  await fixture.open();
  await expect(page.getByText(/Staffing not started/)).toBeVisible();
  expect(await backend.schedules()).toEqual([]);
  expect(await backend.claims()).toEqual([]);
  await fixture.assign();
  const first: any = await backend.schedule();
  expect(first.published).toBe(false);
  expect(first.occurrences).toHaveLength(1);
  await page.reload();
  await expect(page.locator('[data-schedule-cell-trigger]').first()).toContainText(TEST_MEMBER_NAME);
  const repeated: any = await fixture.ensureAgain();
  expect(repeated.created).toBe(false);
  expect(repeated.schedule.scheduleId).toBe(scope.scheduleId);
  expect((await backend.schedules()).map(schedule => schedule.scheduleId)).toEqual([scope.scheduleId]);
  expect((await backend.schedule() as any).assignments).toEqual(first.assignments);
  expect(await backend.claims()).toHaveLength(1);
});

test("B — real reconciliation adds an occurrence and preserves assignments and operational fields", async ({ scheduling: fixture }) => {
  const { backend, page, scope } = fixture;
  await fixture.open();
  await fixture.assign();
  const first: any = await backend.schedule();
  await applicationApi(page, "addTeamSchedulePositionSlot", [scope.churchId, scope.scheduleId, { serviceId: first.occurrences[0].occurrenceId, positionSlotKey: `${scope.positionId}::1` }]);
  const before: any = await backend.schedule();
  expect(Object.keys(before.additionalPositionSlots)).toHaveLength(1);
  await backend.addService(1);
  await page.reload();
  await expect.poll(async () => (await backend.schedule() as any)?.occurrences?.length, { timeout: 30_000 }).toBe(2);
  const after: any = await backend.schedule();
  expect(after.scheduleId).toBe(first.scheduleId);
  for (const key of ["assignments", "additionalPositionSlots", "microphoneAssignments", "iemAssignments", "guests", "createdAt", "createdByUid", "published", "e2eFixture"]) expect(after[key], key).toEqual(before[key]);
  expect(after.occurrences.some((row: any) => row.serviceId === scope.serviceIds[1])).toBe(true);
  const repeated: any = await fixture.ensureAgain();
  expect(repeated.created).toBe(false);
  expect(repeated.schedule.occurrences).toHaveLength(2);
  expect(new Set(repeated.schedule.occurrences.map((row: any) => row.occurrenceId)).size).toBe(2);
  expect(await backend.schedules()).toHaveLength(1);
  expect(await backend.claims()).toHaveLength(2);
  expect((await backend.schedule() as any).assignments).toEqual(before.assignments);
});

test("C — deletion releases claims, normal editing regenerates, and failed-workflow cleanup is verified", async ({ scheduling: fixture }) => {
  const { backend, page } = fixture;
  await fixture.open();
  await fixture.assign();
  // Move away before deletion so automatic reconciliation has no mounted editor.
  await page.goto("/#/home");
  await fixture.deleteSchedule();
  await fixture.open();
  expect(await backend.schedules()).toEqual([]);
  expect(await backend.claims()).toEqual([]);
  await fixture.assign();
  expect((await backend.schedule() as any).published).toBe(false);
  expect(await backend.claims()).toHaveLength(1);
  // Exercise the same finally cleanup used after an assertion throws. The
  // sentinel is checked after cleanup; cleanup errors cannot be swallowed.
  let failure: unknown;
  try { throw new Error("simulated scheduling assertion failure"); }
  catch (error) { failure = error; }
  finally { await fixture.cleanup(); }
  expect(String(failure)).toContain("simulated scheduling assertion failure");
  await backend.verifyReleased(false);
  expect(backend.events.some(event => event.status === "cleaned")).toBe(true);
});
