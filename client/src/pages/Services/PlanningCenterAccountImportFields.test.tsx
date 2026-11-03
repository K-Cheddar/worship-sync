import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import PlanningCenterAccountImportFields from "./PlanningCenterAccountImportFields";
import {
  listPlanningCenterPlans,
  listPlanningCenterServiceTypes,
} from "../../api/planningCenter";

jest.mock("../../api/planningCenter", () => ({
  listPlanningCenterPlans: jest.fn(),
  listPlanningCenterServiceTypes: jest.fn(),
}));

const mockListPlans = jest.mocked(listPlanningCenterPlans);
const mockListServiceTypes = jest.mocked(listPlanningCenterServiceTypes);

describe("PlanningCenterAccountImportFields", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListServiceTypes.mockResolvedValue({
      items: [{ id: "type-first", name: "First type" }],
    });
    mockListPlans.mockResolvedValue({ items: [] });
  });

  it("preserves an explicit service type and plan while choices load", async () => {
    const onServiceTypeIdChange = jest.fn();
    const onPlanIdChange = jest.fn();
    mockListServiceTypes.mockResolvedValue({
      items: [{ id: "type-first", name: "First type" }],
    });
    mockListPlans.mockResolvedValue({
      items: [{
        id: "plan-first",
        serviceTypeId: "type-explicit",
        dates: "Nov 1",
        title: "Current plan",
        label: "Nov 1 · Current plan",
        itemsCount: 1,
        sortDate: "2026-11-01",
        sourceUrl: "",
      }],
    });

    render(
      <PlanningCenterAccountImportFields
        churchId="church-1"
        connectionKey="account-one"
        serviceTypeId="type-explicit"
        planId="plan-explicit"
        onServiceTypeIdChange={onServiceTypeIdChange}
        onPlanIdChange={onPlanIdChange}
      />,
    );

    await waitFor(() => expect(mockListPlans).toHaveBeenCalledWith(
      "church-1",
      "type-explicit",
      "future",
    ));
    expect(screen.getByRole("combobox", { name: /^Service type:/ })).toHaveTextContent(
      "Previously selected service type",
    );
    expect(screen.getByRole("combobox", { name: /^Upcoming plan:/ })).toHaveTextContent(
      "Previously selected plan",
    );
    expect(onServiceTypeIdChange).not.toHaveBeenCalled();
    expect(onPlanIdChange).not.toHaveBeenCalled();
  });

  it("clears the selected plan only after an explicit service-type change", async () => {
    const user = userEvent.setup();
    const onServiceTypeIdChange = jest.fn();
    const onPlanIdChange = jest.fn();
    mockListServiceTypes.mockResolvedValue({
      items: [
        { id: "type-first", name: "First type" },
        { id: "type-second", name: "Second type" },
      ],
    });

    render(
      <PlanningCenterAccountImportFields
        churchId="church-1"
        serviceTypeId="type-first"
        planId="plan-explicit"
        onServiceTypeIdChange={onServiceTypeIdChange}
        onPlanIdChange={onPlanIdChange}
      />,
    );

    const serviceTypeSelect = await screen.findByRole("combobox", { name: /^Service type:/ });
    await waitFor(() => expect(serviceTypeSelect).toBeEnabled());
    await user.click(serviceTypeSelect);
    await user.click(await screen.findByRole("option", { name: "Second type" }));

    expect(onServiceTypeIdChange).toHaveBeenCalledWith("type-second");
    expect(onPlanIdChange).toHaveBeenCalledWith("");
  });

  it("drops account A selections and ignores its delayed response after switching to account B", async () => {
    let resolveAccountA!: (value: { items: { id: string; name: string }[] }) => void;
    let resolveAccountB!: (value: { items: { id: string; name: string }[] }) => void;
    mockListServiceTypes
      .mockImplementationOnce(() => new Promise((resolve) => { resolveAccountA = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveAccountB = resolve; }));
    mockListPlans.mockImplementation(async (_churchId, serviceTypeId) => ({
      items: serviceTypeId === "type-b" ? [{
        id: "plan-b",
        serviceTypeId,
        dates: "Nov 8",
        title: "B plan",
        label: "Nov 8 · B plan",
        itemsCount: 1,
        sortDate: "2026-11-08",
        sourceUrl: "",
      }] : [],
    }));

    const Harness = ({ accountId }: { accountId: string }) => {
      const [serviceTypeId, setServiceTypeId] = useState("type-a");
      const [planId, setPlanId] = useState("plan-a");
      return (
        <PlanningCenterAccountImportFields
          churchId="church-1"
          connectionKey={accountId}
          serviceTypeId={serviceTypeId}
          planId={planId}
          onServiceTypeIdChange={setServiceTypeId}
          onPlanIdChange={setPlanId}
        />
      );
    };
    const view = render(<Harness accountId="org-a" />);
    await waitFor(() => expect(mockListServiceTypes).toHaveBeenCalledTimes(1));
    view.rerender(<Harness accountId="org-b" />);
    await waitFor(() => expect(mockListServiceTypes).toHaveBeenCalledTimes(2));

    resolveAccountA({ items: [{ id: "type-a", name: "A type" }] });
    resolveAccountB({ items: [{ id: "type-b", name: "B type" }] });

    await waitFor(() => expect(screen.getByRole("combobox", { name: /^Service type:/ })).toHaveTextContent("B type"));
    await waitFor(() => expect(mockListPlans).toHaveBeenCalledWith("church-1", "type-b", "future"));
    expect(mockListPlans).not.toHaveBeenCalledWith("church-1", "type-a", "future");
    expect(screen.queryByRole("option", { name: "Previously selected plan" })).not.toBeInTheDocument();
  });
});
