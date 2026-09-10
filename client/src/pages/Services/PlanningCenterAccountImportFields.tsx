import { useEffect, useState } from "react";
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

  useEffect(() => {
    let cancelled = false;
    setLoadingTypes(true);
    setErrorMessage("");
    listPlanningCenterServiceTypes(churchId)
      .then((response) => {
        if (cancelled) return;
        setServiceTypes(response.items);
        if (
          response.items.length > 0 &&
          !response.items.some((item) => item.id === serviceTypeId)
        ) {
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
    // Only reload when the church changes; serviceTypeId updates are intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [churchId]);

  useEffect(() => {
    if (!serviceTypeId) {
      setPlans([]);
      return;
    }
    let cancelled = false;
    setLoadingPlans(true);
    setErrorMessage("");
    onPlanIdChange("");
    listPlanningCenterPlans(churchId, serviceTypeId, planRange)
      .then((response) => {
        if (cancelled) return;
        setPlans(response.items);
        if (response.items.length > 0) {
          onPlanIdChange(response.items[0].id);
        } else {
          onPlanIdChange("");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setPlans([]);
        onPlanIdChange("");
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
  }, [churchId, serviceTypeId, planRange]);

  const emptyLabel =
    planRange === "past"
      ? "No past plans in this service type."
      : "No upcoming plans in this service type.";

  return (
    <div className="flex flex-col gap-2">
      <Select
        label="Service type"
        options={serviceTypes.map((item) => ({
          value: item.id,
          label: item.name,
        }))}
        value={serviceTypeId}
        disabled={disabled || loadingTypes || serviceTypes.length === 0}
        onChange={onServiceTypeIdChange}
      />
      <Select
        label="Show"
        options={PLAN_RANGE_OPTIONS}
        value={planRange}
        disabled={disabled || loadingTypes}
        onChange={(value) =>
          setPlanRange(value === "past" ? "past" : "future")
        }
      />
      <Select
        label={planRange === "past" ? "Past plan" : "Upcoming plan"}
        options={plans.map((item) => ({
          value: item.id,
          label: item.label,
        }))}
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
