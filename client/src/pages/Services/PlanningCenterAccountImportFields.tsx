import { useEffect, useRef, useState } from "react";
import Select from "../../components/Select/Select";
import {
  listPlanningCenterPlans,
  listPlanningCenterServiceTypes,
  type PlanningCenterPlanSummary,
  type PlanningCenterServiceType,
} from "../../api/planningCenter";

type PlanRange = "future" | "past";

type Props = {
  churchId: string;
  connectionKey?: string;
  disabled?: boolean;
  serviceTypeId: string;
  planId: string;
  onServiceTypeIdChange: (value: string) => void;
  onPlanIdChange: (value: string) => void;
};

const PLAN_RANGE_OPTIONS = [
  { value: "future", label: "Upcoming" },
  { value: "past", label: "Past" },
];

const PlanningCenterAccountImportFields = ({
  churchId,
  connectionKey = "",
  disabled = false,
  serviceTypeId,
  planId,
  onServiceTypeIdChange,
  onPlanIdChange,
}: Props) => {
  const [planRange, setPlanRange] = useState<PlanRange>("future");
  const [serviceTypes, setServiceTypes] = useState<PlanningCenterServiceType[]>(
    [],
  );
  const [plans, setPlans] = useState<PlanningCenterPlanSummary[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const scopeKey = JSON.stringify([churchId, connectionKey]);
  const previousScopeKeyRef = useRef(scopeKey);
  const [serviceTypesScopeKey, setServiceTypesScopeKey] = useState("");
  const [accountSwitchTypeTarget, setAccountSwitchTypeTarget] = useState<string | null>(null);
  const currentPlanIdRef = useRef(planId);
  currentPlanIdRef.current = planId;

  useEffect(() => {
    let cancelled = false;
    const accountChanged = previousScopeKeyRef.current !== scopeKey;
    previousScopeKeyRef.current = scopeKey;
    setServiceTypesScopeKey("");
    setPlans([]);
    if (accountChanged) {
      setPlanRange("future");
      setAccountSwitchTypeTarget("");
      currentPlanIdRef.current = "";
      onServiceTypeIdChange("");
      onPlanIdChange("");
    }
    setLoadingTypes(true);
    setErrorMessage("");
    listPlanningCenterServiceTypes(churchId)
      .then((response) => {
        if (cancelled) return;
        setServiceTypes(response.items);
        setServiceTypesScopeKey(scopeKey);
        if (accountChanged) {
          const nextTypeId = response.items[0]?.id || "";
          setAccountSwitchTypeTarget(nextTypeId);
          onServiceTypeIdChange(nextTypeId);
        } else if (!serviceTypeId && response.items.length > 0) {
          onServiceTypeIdChange(response.items[0].id);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setServiceTypes([]);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Could not load Planning Center service types.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingTypes(false);
      });
    return () => {
      cancelled = true;
    };
    // Keep a resolved service type even when it is not currently listed. The
    // operator can still choose another type explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [churchId, connectionKey, scopeKey]);

  useEffect(() => {
    if (
      !serviceTypeId ||
      serviceTypesScopeKey !== scopeKey ||
      (accountSwitchTypeTarget !== null && serviceTypeId !== accountSwitchTypeTarget)
    ) {
      setPlans([]);
      return;
    }
    if (accountSwitchTypeTarget !== null) setAccountSwitchTypeTarget(null);
    let cancelled = false;
    setLoadingPlans(true);
    setErrorMessage("");
    listPlanningCenterPlans(churchId, serviceTypeId, planRange)
      .then((response) => {
        if (cancelled) return;
        setPlans(response.items);
        const selectedPlanId = currentPlanIdRef.current;
        if (!selectedPlanId && response.items.length > 0) {
          onPlanIdChange(response.items[0].id);
        } else if (!selectedPlanId) {
          onPlanIdChange("");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setPlans([]);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Could not load Planning Center plans.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingPlans(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [churchId, connectionKey, scopeKey, serviceTypesScopeKey, accountSwitchTypeTarget, serviceTypeId, planRange]);

  const emptyLabel =
    planRange === "past"
      ? "No past plans in this service type."
      : "No upcoming plans in this service type.";
  const selectedServiceTypeIsMissing = Boolean(
    serviceTypeId && !serviceTypes.some((item) => item.id === serviceTypeId),
  );
  const selectedPlanIsMissing = Boolean(
    planId && !plans.some((item) => item.id === planId),
  );

  return (
    <div className="flex flex-col gap-2">
      <Select
        label="Service type"
        options={[
          ...(selectedServiceTypeIsMissing
            ? [{ value: serviceTypeId, label: "Previously selected service type" }]
            : []),
          ...serviceTypes.map((item) => ({
            value: item.id,
            label: item.name,
          })),
        ]}
        value={serviceTypeId}
        disabled={disabled || loadingTypes || serviceTypes.length === 0}
        onChange={(value) => {
          onServiceTypeIdChange(value);
          onPlanIdChange("");
        }}
      />
      <Select
        label="Show"
        options={PLAN_RANGE_OPTIONS}
        value={planRange}
        disabled={disabled || loadingTypes}
        onChange={(value) => {
          onPlanIdChange("");
          setPlanRange(value === "past" ? "past" : "future");
        }}
      />
      <Select
        label={planRange === "past" ? "Past plan" : "Upcoming plan"}
        options={[
          ...(selectedPlanIsMissing
            ? [{ value: planId, label: "Previously selected plan" }]
            : []),
          ...plans.map((item) => ({
            value: item.id,
            label: item.label,
          })),
        ]}
        value={planId}
        disabled={
          disabled || loadingPlans || !serviceTypeId || plans.length === 0
        }
        onChange={onPlanIdChange}
      />
      {loadingTypes || loadingPlans ? (
        <p className="text-xs text-gray-400">Loading from Planning Center…</p>
      ) : null}
      {!loadingTypes && !loadingPlans && !errorMessage && plans.length === 0 ? (
        <p className="text-xs text-gray-400">{emptyLabel}</p>
      ) : null}
      {errorMessage ? (
        <p className="text-xs text-amber-100/90">{errorMessage}</p>
      ) : null}
    </div>
  );
};

export default PlanningCenterAccountImportFields;
