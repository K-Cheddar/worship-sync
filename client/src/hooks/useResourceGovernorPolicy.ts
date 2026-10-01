import { useEffect, useState } from "react";
import type { ResourcePolicy } from "../../electron/resourceGovernor";

/** Reads the single main-process policy snapshot; renderers never derive pressure locally. */
export const useResourceGovernorPolicy = (): ResourcePolicy | undefined => {
  const [policy, setPolicy] = useState<ResourcePolicy>();

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.subscribeResourceGovernorPolicy) return;
    const unsubscribe = api.subscribeResourceGovernorPolicy(setPolicy);
    return unsubscribe;
  }, []);

  return policy;
};
