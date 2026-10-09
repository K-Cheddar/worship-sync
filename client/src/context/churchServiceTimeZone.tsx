import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getChurchServiceTimeZone } from "../api/auth";
import { GlobalInfoContext } from "./globalInfo";

type TimeZoneStatus = "loading" | "ready" | "error";

type ChurchServiceTimeZoneValue = {
  status: TimeZoneStatus;
  timeZone: string | null;
  isConfigured: boolean;
  legacyTimeZoneSuggestion: string | null;
  refresh: () => Promise<void>;
};

const ChurchServiceTimeZoneContext =
  createContext<ChurchServiceTimeZoneValue | null>(null);

export const ChurchServiceTimeZoneProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const globalInfo = useContext(GlobalInfoContext);
  const churchId = globalInfo?.churchId || "";
  const canRead = Boolean(
    churchId &&
      globalInfo?.loginState === "success" &&
      (globalInfo.sessionKind === "human" ||
        globalInfo.sessionKind === "workstation"),
  );
  const [status, setStatus] = useState<TimeZoneStatus>("loading");
  const [resolvedChurchId, setResolvedChurchId] = useState("");
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [legacyTimeZoneSuggestion, setLegacyTimeZoneSuggestion] =
    useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canRead) return;
    setStatus("loading");
    try {
      const result = await getChurchServiceTimeZone(churchId);
      setResolvedChurchId(churchId);
      setTimeZone(result.serviceTimeZone);
      setIsConfigured(result.isConfigured);
      setLegacyTimeZoneSuggestion(result.legacyTimeZoneSuggestion || null);
      setStatus("ready");
    } catch (error) {
      setResolvedChurchId(churchId);
      setStatus("error");
      throw error;
    }
  }, [canRead, churchId]);

  useEffect(() => {
    if (!canRead) {
      setTimeZone(null);
      setResolvedChurchId(churchId);
      setIsConfigured(false);
      setLegacyTimeZoneSuggestion(null);
      setStatus(churchId ? "error" : "loading");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    void getChurchServiceTimeZone(churchId)
      .then((result) => {
        if (cancelled) return;
        setResolvedChurchId(churchId);
        setTimeZone(result.serviceTimeZone);
        setIsConfigured(result.isConfigured);
        setLegacyTimeZoneSuggestion(result.legacyTimeZoneSuggestion || null);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedChurchId(churchId);
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canRead, churchId]);

  const value = useMemo(
    () => ({
      status: resolvedChurchId === churchId ? status : "loading",
      timeZone: resolvedChurchId === churchId ? timeZone : null,
      isConfigured: resolvedChurchId === churchId && isConfigured,
      legacyTimeZoneSuggestion:
        resolvedChurchId === churchId ? legacyTimeZoneSuggestion : null,
      refresh,
    }),
    [churchId, isConfigured, legacyTimeZoneSuggestion, refresh, resolvedChurchId, status, timeZone],
  );

  return (
    <ChurchServiceTimeZoneContext.Provider value={value}>
      {children}
    </ChurchServiceTimeZoneContext.Provider>
  );
};

export const useChurchServiceTimeZone = () => {
  const value = useContext(ChurchServiceTimeZoneContext);
  if (!value) {
    throw new Error(
      "useChurchServiceTimeZone must be used within ChurchServiceTimeZoneProvider.",
    );
  }
  return value;
};
