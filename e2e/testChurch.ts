export const E2E_CHURCH_ID = "demo";

/**
 * Keep the demo church as the single E2E target. The old environment variable
 * is accepted only as a deprecated assertion of that same identity.
 */
export function getE2EChurchId(env: Record<string, string | undefined> = process.env) {
  if (
    Object.prototype.hasOwnProperty.call(env, "E2E_DEMO_CHURCH_ID") &&
    env.E2E_DEMO_CHURCH_ID?.trim() !== E2E_CHURCH_ID
  ) {
    throw new Error(
      `E2E_DEMO_CHURCH_ID is deprecated; WorshipSync E2E tests always use church ${E2E_CHURCH_ID}. Remove the variable or set it to ${E2E_CHURCH_ID}.`,
    );
  }
  return E2E_CHURCH_ID;
}
