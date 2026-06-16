/**
 * Default wording shown on the public intake form. Form creators can override
 * any of these per form (see `welcomeMessage`/`positionsMessage`/
 * `availabilityMessage`/`notesMessage` on `TeamIntakeForm`); when an override
 * is blank, the public form falls back to the matching default here.
 *
 * The editor uses these same strings as field placeholders so creators can see
 * the fallback they are replacing.
 */
export const DEFAULT_INTAKE_FORM_COPY = {
  welcome:
    "Share the positions you can serve in, your availability, and any dates you're away.",
  positions: "Check the positions you can serve in.",
  availability: "Mark each date you're available to serve.",
  notes: "Anything else we should know?",
} as const;

/** Resolve an optional per-form override against its default. */
export const resolveIntakeCopy = (
  override: string | undefined,
  fallback: string,
) => {
  const trimmed = override?.trim();
  return trimmed ? trimmed : fallback;
};
