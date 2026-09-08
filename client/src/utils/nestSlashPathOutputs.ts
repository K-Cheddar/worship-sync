/**
 * Expand Firebase multi-path update keys into nested objects.
 *
 * `buildRemoteOutputs` emits slash keys (`out_lobby/info`) so RTDB `update()`
 * can patch fields independently. That shape is wrong for localStorage: the
 * display window's `updateOutputsFromRemote` expects
 * `{ [outputId]: { type, info, … } }`. Dumping slash keys there forces named
 * outputs to wait on the Firebase round-trip, so same-machine aux sends feel
 * remote while built-ins (which use whole-object keys) stay instant.
 *
 * Already-nested payloads pass through unchanged so Firebase `onValue` and a
 * corrected localStorage write share one receive path.
 */
export const nestSlashPathOutputs = (
  raw: Record<string, unknown> | null | undefined,
): Record<string, Record<string, unknown>> => {
  if (!raw || typeof raw !== "object") return {};

  const nested: Record<string, Record<string, unknown>> = {};

  for (const [key, value] of Object.entries(raw)) {
    const slash = key.indexOf("/");
    if (slash === -1) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        nested[key] = {
          ...(nested[key] ?? {}),
          ...(value as Record<string, unknown>),
        };
      }
      continue;
    }

    const id = key.slice(0, slash);
    const field = key.slice(slash + 1);
    if (!id || !field || field.includes("/")) continue;

    nested[id] = {
      ...(nested[id] ?? {}),
      [field]: value,
    };
  }

  return nested;
};
