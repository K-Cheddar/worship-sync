/**
 * Ops helpers that must never ship in production builds.
 * Gate on Vite DEV so production bundles tree-shake the entry points away.
 */
export const isCreateChurchUiEnabled = (): boolean =>
  Boolean(import.meta.env.DEV);
