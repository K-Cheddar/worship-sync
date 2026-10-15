import { useCallback, useEffect, useRef, useState } from "react";
import { getNotificationIntents } from "../../../api/auth";
import type { NotificationIntent } from "../../../api/authTypes";
import { showApiErrorToast } from "../../../utils/apiErrorToast";
import {
  isPersistedScheduleId,
  mergeScheduleNotificationIntents,
  scheduleNotificationHistoryScope,
} from "./scheduleNotificationHistory";

export const useScheduleNotificationHistory = ({
  churchId,
  scheduleId,
  canEdit,
  showToast,
}: {
  churchId: string;
  scheduleId: string;
  canEdit: boolean;
  showToast: Parameters<typeof showApiErrorToast>[0];
}) => {
  const [intents, setIntents] = useState<NotificationIntent[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyScope, setHistoryScope] = useState("");
  const requestGenerationRef = useRef(0);
  const requestScopeRef = useRef("");
  const currentScope = scheduleNotificationHistoryScope(churchId, scheduleId, canEdit);
  const hasCurrentHistory = Boolean(currentScope) && historyScope === currentScope;

  useEffect(() => {
    const scope = scheduleNotificationHistoryScope(churchId, scheduleId, canEdit);
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    requestScopeRef.current = scope;
    setHistoryScope(scope);
    setIntents([]);
    setNextCursor("");
    setLoading(Boolean(scope));

    if (!scope) {
      return () => {
        if (requestGenerationRef.current === generation) {
          requestGenerationRef.current += 1;
          requestScopeRef.current = "";
        }
      };
    }

    let active = true;
    const isCurrent = () => active && requestGenerationRef.current === generation && requestScopeRef.current === scope;
    void getNotificationIntents(churchId, { scheduleId })
      .then((response) => {
        if (!isCurrent()) return;
        setIntents(response.intents || []);
        setNextCursor(response.nextCursor || "");
      })
      .catch((error) => {
        if (isCurrent()) showApiErrorToast(showToast, error, "Could not load schedule message status.");
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });

    return () => {
      active = false;
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current += 1;
        requestScopeRef.current = "";
      }
    };
  }, [canEdit, churchId, scheduleId, showToast]);

  const refresh = useCallback(async (requestedScheduleId: string) => {
    if (
      requestedScheduleId !== scheduleId ||
      !churchId ||
      !canEdit ||
      !isPersistedScheduleId(requestedScheduleId)
    ) return;
    const scope = scheduleNotificationHistoryScope(churchId, scheduleId, canEdit);
    const generation = requestGenerationRef.current;
    const response = await getNotificationIntents(churchId, { scheduleId: requestedScheduleId });
    if (requestGenerationRef.current !== generation || requestScopeRef.current !== scope) return;
    setIntents((current) => mergeScheduleNotificationIntents(current, response.intents || []));
    setNextCursor(response.nextCursor || "");
  }, [canEdit, churchId, scheduleId]);

  const currentGeneration = requestGenerationRef.current;
  const addIntents = useCallback((incoming: NotificationIntent[]) => {
    if (!currentScope || !hasCurrentHistory || !isPersistedScheduleId(scheduleId)) return;
    const scope = currentScope;
    if (requestGenerationRef.current !== currentGeneration || requestScopeRef.current !== scope) return;
    setIntents((current) => mergeScheduleNotificationIntents(current, incoming));
  }, [currentGeneration, currentScope, hasCurrentHistory, scheduleId]);

  const loadOlder = useCallback(async () => {
    if (
      !currentScope ||
      !hasCurrentHistory ||
      !isPersistedScheduleId(scheduleId) ||
      !nextCursor ||
      loading
    ) return;
    const scope = currentScope;
    const generation = requestGenerationRef.current;
    const cursor = nextCursor;
    setLoading(true);
    try {
      const response = await getNotificationIntents(churchId, { scheduleId, cursor });
      if (requestGenerationRef.current !== generation || requestScopeRef.current !== scope) return;
      setIntents((current) => mergeScheduleNotificationIntents(current, response.intents || []));
      setNextCursor(response.nextCursor || "");
    } catch (error) {
      if (requestGenerationRef.current === generation && requestScopeRef.current === scope) {
        showApiErrorToast(showToast, error, "Could not load older schedule message history.");
      }
    } finally {
      if (requestGenerationRef.current === generation && requestScopeRef.current === scope) {
        setLoading(false);
      }
    }
  }, [churchId, currentScope, hasCurrentHistory, loading, nextCursor, scheduleId, showToast]);

  return {
    intents: hasCurrentHistory ? intents : [],
    nextCursor: hasCurrentHistory ? nextCursor : "",
    loading: Boolean(currentScope) && (!hasCurrentHistory || loading),
    refresh,
    addIntents,
    loadOlder,
  };
};
