import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { listServicePlanTemplates } from "../../../api/auth";
import { GlobalInfoContext } from "../../../context/globalInfo";
import type { ServicePlanTemplate } from "../../../types/servicePlan";

type TemplateResourceState = {
  churchId: string;
  data: ServicePlanTemplate[];
  loaded: boolean;
  loading: boolean;
  error: unknown | null;
};

const emptyResource = (churchId: string): TemplateResourceState => ({
  churchId,
  data: [],
  loaded: false,
  loading: false,
  error: null,
});

/** Church-lifetime server resources owned by TeamsPageProvider. */
export const useTeamsDomainResources = () => {
  const churchId = useContext(GlobalInfoContext)?.churchId || "";
  const [resourceState, setResourceState] = useState(() => emptyResource(churchId));
  const resourceRef = useRef(resourceState);
  const activeChurchIdRef = useRef(churchId);
  const observedChurchIdRef = useRef(churchId);
  const requestGenerationRef = useRef(0);
  const inFlightRef = useRef<{
    churchId: string;
    promise: Promise<void>;
    changes: Map<string, ServicePlanTemplate | null>;
  } | null>(null);

  // Keep async completions scoped even in the render before the reset effect.
  activeChurchIdRef.current = churchId;
  if (observedChurchIdRef.current !== churchId) {
    observedChurchIdRef.current = churchId;
    requestGenerationRef.current += 1;
    inFlightRef.current = null;
  }

  const commitResource = useCallback((next: TemplateResourceState) => {
    resourceRef.current = next;
    setResourceState(next);
  }, []);

  useEffect(() => {
    if (resourceRef.current.churchId === churchId) return;
    commitResource(emptyResource(churchId));
    if (inFlightRef.current?.churchId !== churchId) inFlightRef.current = null;
  }, [churchId, commitResource]);

  const load = useCallback((force: boolean) => {
    if (!churchId || activeChurchIdRef.current !== churchId) return Promise.resolve();
    const current = resourceRef.current;
    if (current.churchId === churchId && current.loaded && !force) {
      return Promise.resolve();
    }
    const inFlight = inFlightRef.current;
    if (inFlight?.churchId === churchId) return inFlight.promise;

    const initialData = current.churchId === churchId ? current.data : [];
    commitResource({
      churchId,
      data: initialData,
      loaded: current.churchId === churchId && current.loaded,
      loading: true,
      error: null,
    });

    const request = {
      churchId,
      generation: ++requestGenerationRef.current,
      promise: Promise.resolve(),
      changes: new Map<string, ServicePlanTemplate | null>(),
    };
    const isCurrentRequest = () =>
      activeChurchIdRef.current === churchId &&
      requestGenerationRef.current === request.generation &&
      inFlightRef.current === request;
    request.promise = listServicePlanTemplates(churchId)
      .then((response) => {
        if (!isCurrentRequest()) return;
        let merged = new Map(
          (response.templates || []).map((template) => [template.templateId, template]),
        );
        request.changes.forEach((template, templateId) => {
          if (template) merged.set(templateId, template);
          else merged.delete(templateId);
        });
        commitResource({
          churchId,
          data: [...merged.values()],
          loaded: true,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (!isCurrentRequest()) return;
        const latest = resourceRef.current;
        commitResource({
          churchId,
          data: latest.churchId === churchId ? latest.data : initialData,
          loaded: latest.churchId === churchId && latest.loaded,
          loading: false,
          error,
        });
        throw error;
      })
      .finally(() => {
        if (inFlightRef.current === request) inFlightRef.current = null;
      });
    inFlightRef.current = request;
    return request.promise;
  }, [churchId, commitResource]);

  const ensureLoaded = useCallback(() => load(false), [load]);
  const refresh = useCallback(() => load(true), [load]);

  const upsert = useCallback((template: ServicePlanTemplate) => {
    if (
      !churchId ||
      activeChurchIdRef.current !== churchId ||
      template.churchId !== churchId
    ) return;
    if (inFlightRef.current?.churchId === churchId) {
      inFlightRef.current.changes.set(template.templateId, template);
    }
    const current = resourceRef.current;
    const data = current.churchId === churchId ? current.data : [];
    const existingIndex = data.findIndex((item) => item.templateId === template.templateId);
    const nextData = [...data];
    if (existingIndex >= 0) nextData[existingIndex] = template;
    else nextData.push(template);
    commitResource({
      churchId,
      data: nextData,
      loaded: current.churchId === churchId && current.loaded,
      loading: current.churchId === churchId && current.loading,
      error: current.churchId === churchId ? current.error : null,
    });
  }, [churchId, commitResource]);

  const remove = useCallback((templateId: string) => {
    if (!churchId || activeChurchIdRef.current !== churchId) return;
    if (inFlightRef.current?.churchId === churchId) {
      inFlightRef.current.changes.set(templateId, null);
    }
    const current = resourceRef.current;
    const data = current.churchId === churchId ? current.data : [];
    commitResource({
      churchId,
      data: data.filter((item) => item.templateId !== templateId),
      loaded: current.churchId === churchId && current.loaded,
      loading: current.churchId === churchId && current.loading,
      error: current.churchId === churchId ? current.error : null,
    });
  }, [churchId, commitResource]);

  const visibleState = resourceState.churchId === churchId
    ? resourceState
    : emptyResource(churchId);

  const templates = useMemo(
    () => ({
      data: visibleState.data,
      loaded: visibleState.loaded,
      loading: visibleState.loading,
      error: visibleState.error,
      ensureLoaded,
      refresh,
      upsert,
      remove,
    }),
    [visibleState, ensureLoaded, refresh, upsert, remove],
  );

  return useMemo(() => ({ templates }), [templates]);
};
