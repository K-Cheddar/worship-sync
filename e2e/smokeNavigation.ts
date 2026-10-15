import { expect, type Page } from "@playwright/test";

export async function openEditableTeam(page: Page) {
  const editableTeam = page.getByTestId("entity-row").filter({
    has: page.getByRole("button", { name: /^Edit / }),
  }).first();
  await expect(
    editableTeam,
    "The saved E2E account needs edit access to at least one active team.",
  ).toBeVisible();
  await editableTeam.getByRole("button", { name: /^Edit / }).click();

  await expect(page.getByRole("heading", { name: "Edit team", exact: true })).toBeVisible();
  const editor = page.getByRole("region", { name: "Edit team", exact: true });
  await expect(editor.getByText("Members", { exact: true })).toBeVisible();
  await expect(editor.getByText("Positions", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit positions", exact: true })).toBeVisible();
}

export async function checkSchedulingPeriodRoundTrip(page: Page) {
  const range = page.locator('[aria-live="polite"]').filter({ hasText: /\d{4}/ }).first();
  await expect(range).toBeVisible();
  // Navigation switches Upcoming's text label to the custom range input.
  // Compare dates so both visible representations describe the same period.
  const readRange = async () => {
    const input = page.getByRole("textbox", { name: "Custom date range", exact: true });
    const text = await input.count() ? await input.inputValue() : await range.innerText();
    return text.split(" \u00b7 ")[0].split(/\s+[\u2013\u2014]\s+/).map((part) => {
      const date = new Date(part);
      if (Number.isNaN(date.getTime())) throw new Error(`Invalid schedule range: ${text}`);
      return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }).join("/");
  };
  const initialRange = await readRange();

  const scheduleControls = page.getByRole("group", { name: "Team schedule controls" });
  await expect(
    scheduleControls,
    "Scheduling requires an active team with a service occurrence and positions in the selected period.",
  ).toBeVisible();
  await expect(page.getByText(/Loading this schedule.s assignments/)).toBeHidden();
  await expect(page.getByRole("group", { name: "Schedule layout" })).toBeVisible();

  await page.getByRole("button", { name: "Next period" }).click();
  await expect.poll(readRange).not.toBe(initialRange);
  // Only the explicit no-occurrences state is a valid alternative. A loading,
  // permission, or data error cannot satisfy either branch.
  const emptyPeriod = page.getByText("No service occurrences are configured for this period.", { exact: false });
  await expect(scheduleControls.or(emptyPeriod)).toBeVisible();
  await expect(page.getByText(/Loading this schedule.s assignments/)).toBeHidden();

  await page.getByRole("button", { name: "Previous period" }).click();
  await expect.poll(readRange).toBe(initialRange);
  await expect(scheduleControls).toBeVisible();
  await expect(page.getByText(/Loading this schedule.s assignments/)).toBeHidden();
}
